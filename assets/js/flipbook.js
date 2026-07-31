/**
 * Frontend + admin-preview flipbook viewer.
 * Renders a PDF (via PDF.js) into page elements and drives page-turn
 * animation + UI chrome (via StPageFlip). Exposes window.ArfbFlipbook
 * so the admin uploader can (re)initialize a preview after upload.
 *
 * Requires, loaded before this file:
 *   - PDF.js core build          -> window.pdfjsLib
 *   - StPageFlip browser build   -> window.St.PageFlip
 *   - arfbConfig (wp_localize_script): { pdfWorkerSrc, i18n }
 */
( function ( window, document ) {
	'use strict';

	var config = window.arfbConfig || { pdfWorkerSrc: '', i18n: {} };
	var t = config.i18n || {};

	if ( window.pdfjsLib && config.pdfWorkerSrc ) {
		window.pdfjsLib.GlobalWorkerOptions.workerSrc = config.pdfWorkerSrc;
	}

	var PAGES_AROUND_CURRENT = 2; // how many spreads either side of the current one get rendered eagerly

	// Upper bound on a single page's rendered canvas width, in device pixels.
	// Pages are rendered high-res and downscaled by CSS so they stay crisp when
	// enlarged (e.g. fullscreen); this cap keeps canvases from getting enormous
	// on very high-resolution / 4K displays.
	var MAX_RENDER_WIDTH = 2400;

	// Higher cap used when a page is zoomed in, so its canvas is re-rendered
	// with enough real pixels to stay sharp at magnification (memory for these
	// larger canvases is reclaimed when the zoom is reset).
	var MAX_RENDER_WIDTH_ZOOM = 3000;

	// Maximum magnification for the zoom gesture and the +/- buttons, and the
	// multiplier applied per button click.
	var MAX_ZOOM = 4;
	var ZOOM_STEP = 1.5;

	// Build a small inline SVG icon from a single path, inheriting currentColor.
	function arfbIcon( path ) {
		return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
			'<path d="' + path + '" fill="none" stroke="currentColor" stroke-width="2" ' +
			'stroke-linecap="round" stroke-linejoin="round"/></svg>';
	}

	/**
	 * One instance per .arfb-flipbook container.
	 */
	function FlipbookInstance( container ) {
		this.container = container;
		this.pdfUrl = container.getAttribute( 'data-pdf-url' );
		this.title = container.getAttribute( 'data-title' ) || '';
		this.pdfDoc = null;
		this.pageFlip = null;
		this.requestedPage = null;
		this.pageEls = [];
		this.renderedPages = {};
		this.renderedWidth = {}; // device-px width each page was last rendered at
		this.zoomedPages = {}; // pages currently rendered at zoom resolution
		this.reducedMotion = window.matchMedia && window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;

		this._buildChrome();
		this._load();
	}

	FlipbookInstance.prototype._buildChrome = function () {
		var self = this;
		this.container.innerHTML = '';
		this.container.classList.add( 'arfb-flipbook--loading' );
		this.container.setAttribute( 'role', 'region' );
		this.container.setAttribute( 'aria-label', this.title );

		// Show a loading message while the PDF downloads.
		var status = document.createElement( 'p' );
		status.className = 'arfb-flipbook__status';
		status.textContent = t.loading || 'Loading…';
		this.container.appendChild( status );
		this.statusEl = status;

		// Live region for page-change announcements (screen readers).
		var live = document.createElement( 'div' );
		live.className = 'arfb-visually-hidden';
		live.setAttribute( 'aria-live', 'polite' );
		this.container.appendChild( live );
		this.liveRegion = live;

		this.container.addEventListener( 'keydown', function ( e ) {
			if ( ! self.pageFlip ) {
				return;
			}
			if ( e.key === 'ArrowRight' ) {
				self.pageFlip.flipNext();
			} else if ( e.key === 'ArrowLeft' ) {
				self.pageFlip.flipPrev();
			} else if ( e.key === 'Home' ) {
				self.pageFlip.flip( 0 );
			} else if ( e.key === 'End' ) {
				self.pageFlip.flip( self.pageEls.length - 1 );
			} else {
				return;
			}
			e.preventDefault();
		} );
	};

	FlipbookInstance.prototype._load = function () {
		var self = this;

		// Error if PDF URL or PDF.js is missing
		if ( ! this.pdfUrl || ! window.pdfjsLib ) {
			this._showError();
			return;
		}

		// Load the PDF document and render the first page shell.
		window.pdfjsLib
			.getDocument( this.pdfUrl )
			.promise.then( function ( pdfDoc ) {
				self.pdfDoc = pdfDoc;
				return pdfDoc.getPage( 1 ).then( function ( firstPage ) {
					return { firstPage: firstPage };
				} );
			} )
			.then( function ( ctx ) {
				self._buildPageShells( ctx.firstPage );
				return self._loadOutline();
			} )
			.then( function () {
				self._initPageFlip();
				self.container.classList.remove( 'arfb-flipbook--loading' );
				self.statusEl.remove();
			} )
			.catch( function ( err ) {
				self._showError( err );
			} );
	};

	FlipbookInstance.prototype._showError = function ( err ) {
		if ( err ) {
			// eslint-disable-next-line no-console
			console.error( 'Annual Report Flipbook:', err );
		}
		this.container.classList.remove( 'arfb-flipbook--loading' );
		this.container.classList.add( 'arfb-flipbook--error' );
		// fallback message and a link to download the PDF.
		this.container.innerHTML =
			'<p class="arfb-flipbook__status">' + ( t.loadError || 'Sorry, the report could not be loaded.' ) + '</p>' +
			'<p><a href="' + this.pdfUrl + '">' + ( t.download || 'Download PDF' ) + '</a></p>' +
			'<p class="arfb-flipbook__note">Note: To view an accessible version of the report, download Ontario Superior Court of Justice: Progressing In The Public Interest 2024 – 2025 Report to view the PDF.</p>';
	};

	/**
	 * Create one lightweight placeholder <div class="arfb-page"> per PDF page,
	 * sized to the first page's aspect ratio. Actual canvas + text-layer content
	 * is filled in lazily by _renderPage() as the reader approaches each page.
	 */
	FlipbookInstance.prototype._buildPageShells = function ( firstPage ) {
		var self = this;
		var viewport = firstPage.getViewport( { scale: 1 } );
		var aspect = viewport.height / viewport.width;

		// The stage wraps the page area and hosts the side arrows, so they can
		// be positioned against the book's edges without becoming children of
		// the StPageFlip-managed pages element.
		var stage = document.createElement( 'div' );
		stage.className = 'arfb-flipbook__stage';
		this.container.appendChild( stage );
		this.stage = stage;

		var viewerEl = document.createElement( 'div' );
		viewerEl.className = 'arfb-flipbook__pages';
		stage.appendChild( viewerEl );
		this.viewerEl = viewerEl;

		for ( var i = 1; i <= this.pdfDoc.numPages; i++ ) {
			var pageEl = document.createElement( 'div' );
			pageEl.className = 'arfb-page';
			pageEl.dataset.pageNumber = String( i );
			pageEl.style.aspectRatio = ( 1 / aspect ).toFixed( 4 );
			viewerEl.appendChild( pageEl );
			self.pageEls.push( pageEl );
		}

		this._buildNavArrows();
		this._buildToolbar();
	};

	/**
	 * Previous / next page-turn controls, as arrow buttons overlaid on the
	 * left and right edges of the book.
	 */
	FlipbookInstance.prototype._buildNavArrows = function () {
		var self = this;

		function arrow( className, label, path, onClick ) {
			var b = document.createElement( 'button' );
			b.type = 'button';
			b.className = 'arfb-nav ' + className;
			b.setAttribute( 'aria-label', label );
			b.title = label;
			b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
				'<path d="' + path + '" fill="none" stroke="currentColor" stroke-width="2.2" ' +
				'stroke-linecap="round" stroke-linejoin="round"/></svg>';
			b.addEventListener( 'click', onClick );
			self.stage.appendChild( b );
			return b;
		}

		arrow( 'arfb-nav--prev', t.previous || 'Previous page', 'M15 4 7 12l8 8', function () {
			self.pageFlip && self.pageFlip.flipPrev();
		} );
		arrow( 'arfb-nav--next', t.next || 'Next page', 'M9 4l8 8-8 8', function () {
			self.pageFlip && self.pageFlip.flipNext();
		} );
	};

	// Toolbar
	FlipbookInstance.prototype._buildToolbar = function () {
		var self = this;
		var toolbar = document.createElement( 'div' );
		toolbar.className = 'arfb-flipbook__toolbar';

		function iconButton( className, label, path, onClick ) {
			var b = document.createElement( 'button' );
			b.type = 'button';
			b.className = 'arfb-btn ' + className;
			b.setAttribute( 'aria-label', label );
			b.innerHTML = arfbIcon( path );
			b.addEventListener( 'click', onClick );
			toolbar.appendChild( b );
			return b;
		}

		// Zoom controls.
		iconButton( 'arfb-btn--zoom-out', t.zoomOut || 'Zoom out', 'M5 12h14', function () {
			self._zoomBy( 1 / ZOOM_STEP );
		} );
		iconButton( 'arfb-btn--zoom-in', t.zoomIn || 'Zoom in', 'M12 5v14 M5 12h14', function () {
			self._zoomBy( ZOOM_STEP );
		} );

		// Page control: shows the current page as an editable field; type a
		// number and press Enter (or leave the field) to jump. "/ N" is the total.
		var pageControl = document.createElement( 'span' );
		pageControl.className = 'arfb-flipbook__page-control';

		var pageInput = document.createElement( 'input' );
		pageInput.type = 'number';
		pageInput.min = '1';
		pageInput.max = String( this.pageEls.length );
		pageInput.className = 'arfb-flipbook__page-input';
		pageInput.setAttribute( 'aria-label', t.goToPage || 'Go to page' );
		this.pageInput = pageInput;

		var pageTotal = document.createElement( 'span' );
		pageTotal.className = 'arfb-flipbook__page-total';
		pageTotal.textContent = '/ ' + this.pageEls.length;

		function jumpToInput() {
			var n = parseInt( pageInput.value, 10 );
			if ( isNaN( n ) || ! self.pageFlip ) {
				self.requestedPage = null;
				self._updateIndicator( self.currentIndex || 0 ); // restore
				return;
			}
			self.requestedPage = Math.min( Math.max( n, 1 ), self.pageEls.length );
			var target = self.requestedPage - 1; // internal page index
			if ( typeof self.pageFlip.turnToPage === 'function' ) {
				self.pageFlip.turnToPage( target );
			} else if ( typeof self.pageFlip.flipToPage === 'function' ) {
				self.pageFlip.flipToPage( target );
			} else if ( typeof self.pageFlip.show === 'function' ) {
				self.pageFlip.show( target );
			} else {
				self.pageFlip.flip( target );
			}
		}
		pageInput.addEventListener( 'keydown', function ( e ) {
			e.stopPropagation(); // keep arrow keys in the field from flipping pages
			if ( e.key === 'Enter' ) {
				e.preventDefault();
				jumpToInput();
				pageInput.blur();
			}
		} );
		pageInput.addEventListener( 'change', jumpToInput );

		pageControl.appendChild( pageInput );
		pageControl.appendChild( pageTotal );
		toolbar.appendChild( pageControl );

		iconButton(
			'arfb-btn--fullscreen',
			t.fullscreen || 'Toggle fullscreen',
			'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5',
			function () {
				if ( document.fullscreenElement ) {
					document.exitFullscreen();
				} else if ( self.container.requestFullscreen ) {
					self.container.requestFullscreen();
				}
			}
		);

		var download = document.createElement( 'a' );
		download.className = 'arfb-btn arfb-btn--download';
		download.href = this.pdfUrl;
		download.setAttribute( 'download', '' );
		download.setAttribute( 'aria-label', t.download || 'Download PDF' );
		download.innerHTML = arfbIcon( 'M12 3v11 M8 11l4 4 4-4 M5 20h14' );
		toolbar.appendChild( download );

		// Appended (not inserted above the stage) so it overlays the viewer as a
		// floating bar — see the .arfb-flipbook__toolbar styles.
		this.container.appendChild( toolbar );
	};

	FlipbookInstance.prototype._loadOutline = function () {        //embedded books in PDF
		var self = this;
		return this.pdfDoc.getOutline().then( function ( outline ) {
			if ( ! outline || ! outline.length ) {
				return;
			}
			self._buildToc( outline );
		} ).catch( function () {
			// Outline is optional; ignore failures.
		} );
	};

	FlipbookInstance.prototype._buildToc = function ( outline ) {
		var self = this;
		var toc = document.createElement( 'details' );
		toc.className = 'arfb-flipbook__toc';

		var summary = document.createElement( 'summary' );
		summary.textContent = t.tableOfContents || 'Table of contents';
		toc.appendChild( summary );

		var list = document.createElement( 'ul' );
		outline.forEach( function ( item ) {
			var li = document.createElement( 'li' );
			var link = document.createElement( 'a' );
			link.href = '#';
			link.textContent = item.title;
			link.addEventListener( 'click', function ( e ) {
				e.preventDefault();
				self.pdfDoc.getPageIndex( item.dest ? item.dest[ 0 ] : item ).then( function ( index ) {
					self.pageFlip && self.pageFlip.flip( index );
				} ).catch( function () {} );
			} );
			li.appendChild( link );
			list.appendChild( li );
		} );
		toc.appendChild( list );

		this.container.insertBefore( toc, this.stage );
	};

	FlipbookInstance.prototype._initPageFlip = function () {
		var self = this;
		var PageFlip = window.St && window.St.PageFlip;

		if ( ! PageFlip ) {
			this._showError( new Error( 'StPageFlip not loaded' ) );
			return;
		}

		var pageWidth = 600;
		var pageHeight = 848;

		// Height of the displayed two-page spread as a fraction of the viewer
		// width: each of the two pages is half the width, scaled by the page's
		// own aspect ratio. Used to cap the width in fullscreen so the spread
		// doesn't grow taller than the screen (which cuts off the bottom).
		this.spreadHeightRatio = ( pageHeight / pageWidth ) / 2;

		this.pageFlip = new PageFlip( this.viewerEl, {
			width: pageWidth,
			height: pageHeight,
			size: 'stretch',
			minWidth: 200,
			maxWidth: 2000,
			minHeight: 200,
			maxHeight: 2800,
			maxShadowOpacity: 0.5,
			showCover: true, // first & last pages render as single covers
			mobileScrollSupport: true,
			flippingTime: this.reducedMotion ? 1 : 700,
			useMouseEvents: true,
		} );

		this.pageFlip.loadFromHTML( this.pageEls );

		this.pageFlip.on( 'flip', function ( e ) {
			var index = typeof self.pageFlip.getCurrentPageIndex === 'function'
				? self.pageFlip.getCurrentPageIndex()
				: ( e.data != null ? e.data : 0 );
			self._onPageChange( index );
		} );

		// Hide the static spine/gutter shadow while a page is folding or flipping
		// so it doesn't sit awkwardly over the animation
		this.pageFlip.on( 'changeState', function ( e ) {
			self.viewerEl.classList.toggle( 'arfb-flipbook__pages--flipping', e.data !== 'read' );
		} );

		document.addEventListener( 'fullscreenchange', function () {
			self._onFullscreenChange();
		} );

		this.zoomState = { scale: 1, tx: 0, ty: 0, dragging: false };
		this._bindWheelAndZoom();

		this._onPageChange( 0 );
	};

	/**
	 * Mouse-wheel / trackpad behaviour over the book:
	 *   - plain scroll  → flip pages (down/right = next, up/left = prev)
	 *   - Ctrl/Cmd+scroll or a trackpad pinch (reported as a ctrl-wheel event)
	 *     → zoom in/out, anchored at the pointer
	 * When zoomed in, drag to pan; turning the page or double-clicking resets
	 * the zoom. Zooming scales the already high-resolution canvas, so pages
	 * stay crisp.
	 */
	FlipbookInstance.prototype._bindWheelAndZoom = function () {
		var self = this;
		var lastFlip = 0;
		var COOLDOWN = 450; // ms between wheel-driven flips

		this.stage.addEventListener(
			'wheel',
			function ( e ) {
				if ( ! self.pageFlip ) {
					return;
				}

				// --- Zoom gesture: Ctrl/Cmd + wheel, or trackpad pinch ---
				if ( e.ctrlKey || e.metaKey ) {
					e.preventDefault();
					// Anchored at the pointer.
					self._zoomBy( Math.exp( -e.deltaY * 0.0015 ), e.clientX, e.clientY );
					return;
				}

				// --- Plain scroll: flip pages ---
				// Use whichever axis moved more (covers horizontal trackpads).
				var delta = Math.abs( e.deltaY ) >= Math.abs( e.deltaX ) ? e.deltaY : e.deltaX;
				if ( Math.abs( delta ) < 4 ) {
					return;
				}
				e.preventDefault();

				var now = Date.now();
				if ( now - lastFlip < COOLDOWN ) {
					return;
				}
				lastFlip = now;

				if ( delta > 0 ) {
					self.pageFlip.flipNext();
				} else {
					self.pageFlip.flipPrev();
				}
			},
			{ passive: false }
		);

		// Drag to pan while zoomed in. Capture-phase mousedown + stopPropagation
		// keeps StPageFlip (mouse-driven) from treating the drag as a page turn;
		// at scale 1 we don't interfere, so normal flipping/dragging still works.
		this.viewerEl.addEventListener(
			'mousedown',
			function ( e ) {
				var z = self.zoomState;
				if ( z.scale <= 1 ) {
					return;
				}
				e.preventDefault();
				e.stopPropagation();
				z.dragging = true;
				z.startX = e.clientX;
				z.startY = e.clientY;
				z.baseTx = z.tx;
				z.baseTy = z.ty;
				self.viewerEl.classList.add( 'arfb-flipbook__pages--grabbing' );
			},
			true
		);

		window.addEventListener( 'mousemove', function ( e ) {
			var z = self.zoomState;
			if ( ! z.dragging ) {
				return;
			}
			z.tx = z.baseTx + ( e.clientX - z.startX );
			z.ty = z.baseTy + ( e.clientY - z.startY );
			self._applyZoom();
		} );

		window.addEventListener( 'mouseup', function () {
			if ( self.zoomState.dragging ) {
				self.zoomState.dragging = false;
				self.viewerEl.classList.remove( 'arfb-flipbook__pages--grabbing' );
			}
		} );

		// Double-click snaps back to fit.
		this.viewerEl.addEventListener( 'dblclick', function ( e ) {
			if ( self.zoomState.scale > 1 ) {
				e.preventDefault();
				self._resetZoom();
			}
		} );
	};

	/**
	 * Zoom by a multiplicative factor, keeping a screen point fixed. Defaults to
	 * the centre of the book (used by the +/- toolbar buttons); the wheel/pinch
	 * gesture passes the pointer position. Shared so both behave identically.
	 */
	FlipbookInstance.prototype._zoomBy = function ( factor, clientX, clientY ) {
		var z = this.zoomState;
		if ( ! z ) {
			return;
		}
		var rect = this.viewerEl.getBoundingClientRect();
		if ( clientX == null ) {
			clientX = rect.left + rect.width / 2;
		}
		if ( clientY == null ) {
			clientY = rect.top + rect.height / 2;
		}

		var newScale = Math.min( MAX_ZOOM, Math.max( 1, z.scale * factor ) );

		// Back to fit — reset cleanly (also reclaims the zoom-resolution canvases).
		if ( newScale === 1 ) {
			this._resetZoom();
			return;
		}

		// Keep the anchor point under the same screen position after scaling.
		var px = ( clientX - rect.left ) / z.scale;
		var py = ( clientY - rect.top ) / z.scale;
		z.tx += ( clientX - px * newScale ) - rect.left;
		z.ty += ( clientY - py * newScale ) - rect.top;
		z.scale = newScale;
		this._applyZoom();
		this._scheduleZoomRerender();
	};

	FlipbookInstance.prototype._applyZoom = function () {
		var z = this.zoomState;
		var zoomed = z.scale > 1;
		this.viewerEl.style.transformOrigin = '0 0';
		this.viewerEl.style.transform = zoomed
			? 'translate(' + z.tx + 'px,' + z.ty + 'px) scale(' + z.scale + ')'
			: '';
		this.viewerEl.classList.toggle( 'arfb-flipbook__pages--zoomed', zoomed );
	};

	FlipbookInstance.prototype._resetZoom = function ( index ) {
		if ( ! this.zoomState ) {
			return;
		}
		this.zoomState.scale = 1;
		this.zoomState.tx = 0;
		this.zoomState.ty = 0;
		this._applyZoom();

		if ( this._zoomTimer ) {
			clearTimeout( this._zoomTimer );
			this._zoomTimer = null;
		}

		// Reclaim the large zoom-resolution canvases: drop them and let the
		// normal lazy render redraw the visible pages at standard resolution.
		var pages = Object.keys( this.zoomedPages );
		if ( pages.length ) {
			for ( var i = 0; i < pages.length; i++ ) {
				var n = pages[ i ];
				var pageEl = this.pageEls[ n - 1 ];
				if ( pageEl ) {
					var old = pageEl.querySelectorAll( 'canvas, .arfb-page__text-layer' );
					for ( var k = 0; k < old.length; k++ ) {
						old[ k ].remove();
					}
				}
				this.renderedPages[ n ] = false;
				this.renderedWidth[ n ] = 0;
			}
			this.zoomedPages = {};

			var idx = typeof index === 'number'
				? index
				: ( this.pageFlip && this.pageFlip.getCurrentPageIndex
					? this.pageFlip.getCurrentPageIndex()
					: 0 );
			this._renderAround( idx );
		}
	};

	/**
	 * After a zoom gesture settles, re-render the visible spread at a resolution
	 * matching the magnified size so text is as sharp as the source PDF.
	 * Debounced so it runs once the wheel/pinch stops, not on every tick.
	 */
	FlipbookInstance.prototype._scheduleZoomRerender = function () {
		var self = this;
		if ( this._zoomTimer ) {
			clearTimeout( this._zoomTimer );
		}
		this._zoomTimer = setTimeout( function () {
			self._zoomTimer = null;
			if ( ! self.pageFlip ) {
				return;
			}
			var idx = self.pageFlip.getCurrentPageIndex ? self.pageFlip.getCurrentPageIndex() : 0;
			var start = Math.max( 0, idx - 1 );
			var end = Math.min( self.pageEls.length - 1, idx + 2 );
			for ( var i = start; i <= end; i++ ) {
				self._renderPage( i + 1, true );
			}
		}, 180 );
	};

	/**
	 * Keep the spread fitting inside the viewport when fullscreen. At full
	 * screen width StPageFlip would derive a spread height taller than the
	 * screen, so we cap the viewer width to whatever keeps the height within
	 * the space left below the toolbar/TOC, then let StPageFlip re-measure.
	 */
	FlipbookInstance.prototype._onFullscreenChange = function () {
		var isFullscreen = document.fullscreenElement === this.container;

		if ( isFullscreen ) {
			// Space above the pages (toolbar, TOC, etc.) plus a little breathing room.
			var chromeHeight = this.stage.offsetTop;
			var availableHeight = this.container.clientHeight - chromeHeight - 12;
			// The stage's side gutters (room for the arrows) don't hold the book,
			// so add them back in: cap so the BOOK — not the padded stage — fills
			// the available height, using as much of the screen as possible.
			var cs = window.getComputedStyle( this.stage );
			var padX = ( parseFloat( cs.paddingLeft ) || 0 ) + ( parseFloat( cs.paddingRight ) || 0 );
			var maxWidth = ( availableHeight / this.spreadHeightRatio ) + padX;
			this.stage.style.maxWidth = Math.floor( maxWidth ) + 'px';
			this.stage.style.marginLeft = 'auto';
			this.stage.style.marginRight = 'auto';
		} else {
			this.stage.style.maxWidth = '';
			this.stage.style.marginLeft = '';
			this.stage.style.marginRight = '';
		}

		// Let StPageFlip recompute its geometry against the new container size.
		// (rAF so the fullscreen layout has settled before it measures.)
		window.requestAnimationFrame( function () {
			window.dispatchEvent( new Event( 'resize' ) );
		} );
	};

	FlipbookInstance.prototype._onPageChange = function ( index ) {
		this.currentIndex = index;
		this._resetZoom( index );
		this._updateIndicator( index );
		this.requestedPage = null;
		this._renderAround( index );
		this._announce( index );


		/*flipbook front cover */
		var isPageSingle = ( index === 0 ) || ( index === this.pageEls.length - 1 );
		this.viewerEl.classList.toggle( 'arfb-flipbook__pages--single', isPageSingle );



		
	};

	FlipbookInstance.prototype._updateIndicator = function ( index ) {
		// Reflect the current page in the input, unless the user is typing in it.
		if ( ! this.pageInput || document.activeElement === this.pageInput ) {
			return;
		}

		if ( this.requestedPage != null ) {
			this.pageInput.value = String( Math.min( Math.max( this.requestedPage, 1 ), this.pageEls.length ) );
			return;
		}

		this.pageInput.value = String( index + 1 );
	};

	FlipbookInstance.prototype._announce = function ( index ) {
		if ( this.liveRegion ) {
			var template = t.pageOf || 'Page %1$d of %2$d';
			this.liveRegion.textContent = template
				.replace( '%1$d', index + 1 )
				.replace( '%2$d', this.pageEls.length );
		}
	};

	/**
	 * Lazily render the pages near the current spread instead of the whole
	 * document up front, which matters for a long annual report.
	 */
	FlipbookInstance.prototype._renderAround = function ( index, force ) {
		var start = Math.max( 0, index - PAGES_AROUND_CURRENT );
		var end = Math.min( this.pageEls.length - 1, index + PAGES_AROUND_CURRENT );
		for ( var i = start; i <= end; i++ ) {
			this._renderPage( i + 1, force ); // PDF.js pages are 1-indexed
		}
	};

	FlipbookInstance.prototype._renderPage = function ( pageNumber, force ) {
		var self = this;
		var pageEl = this.pageEls[ pageNumber - 1 ];
		var outputScale = window.devicePixelRatio || 1;

		// Zoom multiplier: when magnified, the page is displayed larger than its
		// layout box, so it needs proportionally more real pixels to stay sharp.
		var zoom = ( this.zoomState && this.zoomState.scale > 1 ) ? this.zoomState.scale : 1;

		// The page's current on-screen (CSS) width. May be small right now, but
		// the same page can be blown up much larger — a spread filling the screen
		// in fullscreen (~half the screen width per page), or magnified by zoom.
		// Render to enough device pixels to stay crisp; a high-res canvas
		// downscaled by CSS (see the .arfb-page canvas rule) looks sharp at any
		// display size, which also sidesteps StPageFlip re-sizing a frame later.
		var displayWidth = pageEl.clientWidth || 600;
		var screenWidth = ( window.screen && window.screen.width ) || displayWidth;
		var targetCssWidth = Math.max( displayWidth, screenWidth / 2 );
		var cap = zoom > 1 ? MAX_RENDER_WIDTH_ZOOM : MAX_RENDER_WIDTH;
		var targetDeviceWidth = Math.min( targetCssWidth * outputScale * zoom, cap );

		// Skip if already rendered and either unforced, or already sharp enough
		// for the requested size.
		if ( this.renderedPages[ pageNumber ] && ! force ) {
			return;
		}
		if ( this.renderedPages[ pageNumber ] && ( this.renderedWidth[ pageNumber ] || 0 ) >= targetDeviceWidth - 1 ) {
			return;
		}

		this.renderedPages[ pageNumber ] = true;
		this.renderedWidth[ pageNumber ] = targetDeviceWidth;
		if ( targetDeviceWidth > MAX_RENDER_WIDTH ) {
			this.zoomedPages[ pageNumber ] = true;
		} else {
			delete this.zoomedPages[ pageNumber ];
		}

		this.pdfDoc.getPage( pageNumber ).then( function ( page ) {
			var baseViewport = page.getViewport( { scale: 1 } );
			var renderScale = targetDeviceWidth / baseViewport.width;
			var viewport = page.getViewport( { scale: renderScale } );

			// Keep the old canvas visible and render into a detached canvas first, then swap it in once painted.
			// to avoid a blank flash when re-rendering at a new resolution
			// (e.g. after a zoom)
			var canvas = document.createElement( 'canvas' );
			canvas.width = Math.floor( viewport.width );
			canvas.height = Math.floor( viewport.height );

			page.render( {
				canvasContext: canvas.getContext( '2d' ),
				viewport: viewport,
			} ).promise.then( function () {
				var old = pageEl.querySelectorAll( 'canvas, .arfb-page__text-layer' );
				for ( var k = 0; k < old.length; k++ ) {
					old[ k ].remove();
				}
				pageEl.appendChild( canvas );

				// Selectable/screen-reader text layer, kept in sync with the PDF.js
				// version pinned in assets/vendor/pdfjs. The text-layer entry point
				// has moved across pdf.js releases (TextLayerBuilder vs renderTextLayer
				// vs pdfjsLib.TextLayer) -- verify this against the exact version in
				// assets/vendor/pdfjs before shipping.
				if ( typeof window.pdfjsLib.renderTextLayer === 'function' ) {
					page.getTextContent().then( function ( textContent ) {
						var textLayerDiv = document.createElement( 'div' );
						textLayerDiv.className = 'arfb-page__text-layer';
						textLayerDiv.style.width = viewport.width + 'px';
						textLayerDiv.style.height = viewport.height + 'px';
						// PDF.js 3.x positions/sizes the text spans relative to this
						// CSS variable and errors to the console if it is missing.
						textLayerDiv.style.setProperty( '--scale-factor', String( viewport.scale ) );
						// The text layer is rendered at the same high-res scale as the
						// canvas, then scaled down to the page's current display size so
						// the selectable text stays aligned with what's shown.
						var displayScale = ( pageEl.clientWidth || displayWidth ) / viewport.width;
						textLayerDiv.style.transform = 'scale(' + displayScale + ')';
						pageEl.appendChild( textLayerDiv );

						window.pdfjsLib.renderTextLayer( {
							textContentSource: textContent,
							container: textLayerDiv,
							viewport: viewport,
						} );
					} );
				}
			} ).catch( function ( err ) {
				// A failed render shouldn't leave the page permanently marked as
				// done — allow a later attempt to try again.
				self.renderedPages[ pageNumber ] = false;
				self.renderedWidth[ pageNumber ] = 0;
				// eslint-disable-next-line no-console
				console.error( 'Annual Report Flipbook: failed to render page ' + pageNumber, err );
			} );
		} );
	};

	/**
	 * Public API.
	 */
	var ArfbFlipbook = {
		instances: {},

		init: function ( container ) {
			if ( ! container || container.arfbInitialized ) {
				return;
			}
			container.arfbInitialized = true;
			var instance = new FlipbookInstance( container );
			this.instances[ container.id ] = instance;
			return instance;
		},

		/** Re-point an already-initialized container at a new PDF (used by the admin preview). */
		reload: function ( container, pdfUrl ) {
			container.arfbInitialized = false;
			container.setAttribute( 'data-pdf-url', pdfUrl );
			delete this.instances[ container.id ];
			this.init( container );
		},

		initAll: function () {
			var els = document.querySelectorAll( '.arfb-flipbook:not([data-pdf-url=""])' );
			for ( var i = 0; i < els.length; i++ ) {
				if ( els[ i ].getAttribute( 'data-pdf-url' ) ) {
					this.init( els[ i ] );
				}
			}
		},
	};

	window.ArfbFlipbook = ArfbFlipbook;

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', function () {
			ArfbFlipbook.initAll();
		} );
	} else {
		ArfbFlipbook.initAll();
	}
} )( window, document );

// 3.32
