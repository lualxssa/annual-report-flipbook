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

	/**
	 * One instance per .arfb-flipbook container.
	 */
	function FlipbookInstance( container ) {
		this.container = container;
		this.pdfUrl = container.getAttribute( 'data-pdf-url' );
		this.title = container.getAttribute( 'data-title' ) || '';
		this.pdfDoc = null;
		this.pageFlip = null;
		this.pageEls = [];
		this.renderedPages = {};
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

		if ( ! this.pdfUrl || ! window.pdfjsLib ) {
			this._showError();
			return;
		}

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
		this.container.innerHTML =
			'<p class="arfb-flipbook__status">' + ( t.loadError || 'Sorry, the report could not be loaded.' ) + '</p>' +
			'<p><a href="' + this.pdfUrl + '">' + ( t.download || 'Download PDF' ) + '</a></p>';
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

		var viewerEl = document.createElement( 'div' );
		viewerEl.className = 'arfb-flipbook__pages';
		this.container.appendChild( viewerEl );
		this.viewerEl = viewerEl;

		for ( var i = 1; i <= this.pdfDoc.numPages; i++ ) {
			var pageEl = document.createElement( 'div' );
			pageEl.className = 'arfb-page';
			pageEl.dataset.pageNumber = String( i );
			pageEl.style.aspectRatio = ( 1 / aspect ).toFixed( 4 );
			viewerEl.appendChild( pageEl );
			self.pageEls.push( pageEl );
		}

		this._buildToolbar();
	};

	FlipbookInstance.prototype._buildToolbar = function () {
		var self = this;
		var toolbar = document.createElement( 'div' );
		toolbar.className = 'arfb-flipbook__toolbar';

		function button( label, className, onClick ) {
			var b = document.createElement( 'button' );
			b.type = 'button';
			b.className = 'arfb-btn ' + className;
			b.textContent = label;
			b.addEventListener( 'click', onClick );
			toolbar.appendChild( b );
			return b;
		}

		button( '‹ ' + ( t.previous || 'Previous' ), 'arfb-btn--prev', function () {
			self.pageFlip && self.pageFlip.flipPrev();
		} );

		var pageIndicator = document.createElement( 'span' );
		pageIndicator.className = 'arfb-flipbook__page-indicator';
		toolbar.appendChild( pageIndicator );
		this.pageIndicator = pageIndicator;

		button( ( t.next || 'Next' ) + ' ›', 'arfb-btn--next', function () {
			self.pageFlip && self.pageFlip.flipNext();
		} );

		button( t.fullscreen || 'Fullscreen', 'arfb-btn--fullscreen', function () {
			if ( document.fullscreenElement ) {
				document.exitFullscreen();
			} else if ( self.container.requestFullscreen ) {
				self.container.requestFullscreen();
			}
		} );

		var download = document.createElement( 'a' );
		download.className = 'arfb-btn arfb-btn--download';
		download.href = this.pdfUrl;
		download.textContent = t.download || 'Download PDF';
		download.setAttribute( 'download', '' );
		toolbar.appendChild( download );

		this.container.insertBefore( toolbar, this.viewerEl );
	};

	FlipbookInstance.prototype._loadOutline = function () {
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

		this.container.insertBefore( toc, this.viewerEl );
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
			showCover: false,
			mobileScrollSupport: true,
			flippingTime: this.reducedMotion ? 1 : 700,
			useMouseEvents: true,
		} );

		this.pageFlip.loadFromHTML( this.pageEls );

		this.pageFlip.on( 'flip', function ( e ) {
			self._onPageChange( e.data );
		} );

		document.addEventListener( 'fullscreenchange', function () {
			self._onFullscreenChange();
		} );

		this._onPageChange( 0 );
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
			var chromeHeight = this.viewerEl.offsetTop;
			var availableHeight = this.container.clientHeight - chromeHeight - 24;
			var maxWidth = availableHeight / this.spreadHeightRatio;
			this.viewerEl.style.maxWidth = Math.floor( maxWidth ) + 'px';
			this.viewerEl.style.marginLeft = 'auto';
			this.viewerEl.style.marginRight = 'auto';
		} else {
			this.viewerEl.style.maxWidth = '';
			this.viewerEl.style.marginLeft = '';
			this.viewerEl.style.marginRight = '';
		}

		// Let StPageFlip recompute its geometry against the new container size.
		// (rAF so the fullscreen layout has settled before it measures.)
		window.requestAnimationFrame( function () {
			window.dispatchEvent( new Event( 'resize' ) );
		} );
	};

	FlipbookInstance.prototype._onPageChange = function ( index ) {
		this._updateIndicator( index );
		this._renderAround( index );
		this._announce( index );
	};

	FlipbookInstance.prototype._updateIndicator = function ( index ) {
		if ( ! this.pageIndicator ) {
			return;
		}
		var template = t.pageOf || 'Page %1$d of %2$d';
		this.pageIndicator.textContent = template
			.replace( '%1$d', index + 1 )
			.replace( '%2$d', this.pageEls.length );
	};

	FlipbookInstance.prototype._announce = function ( index ) {
		if ( this.liveRegion ) {
			this.liveRegion.textContent = this.pageIndicator ? this.pageIndicator.textContent : '';
		}
	};

	/**
	 * Lazily render the pages near the current spread instead of the whole
	 * document up front, which matters for a long annual report.
	 */
	FlipbookInstance.prototype._renderAround = function ( index ) {
		var start = Math.max( 0, index - PAGES_AROUND_CURRENT );
		var end = Math.min( this.pageEls.length - 1, index + PAGES_AROUND_CURRENT );
		for ( var i = start; i <= end; i++ ) {
			this._renderPage( i + 1 ); // PDF.js pages are 1-indexed
		}
	};

	FlipbookInstance.prototype._renderPage = function ( pageNumber ) {
		var self = this;
		if ( this.renderedPages[ pageNumber ] ) {
			return;
		}
		this.renderedPages[ pageNumber ] = true;

		this.pdfDoc.getPage( pageNumber ).then( function ( page ) {
			var pageEl = self.pageEls[ pageNumber - 1 ];
			var baseViewport = page.getViewport( { scale: 1 } );
			var outputScale = window.devicePixelRatio || 1;

			// The page's current on-screen (CSS) width. May be small right now,
			// but the same page can be blown up much larger — e.g. a two-page
			// spread filling the screen in fullscreen, up to ~half the screen
			// width per page. Render to whichever is bigger, times the device
			// pixel ratio, so the canvas has enough real pixels to stay crisp
			// when enlarged. A high-res canvas downscaled by CSS (see the
			// .arfb-page canvas rule) looks sharp at any display size, which
			// also sidesteps StPageFlip re-sizing the pages a frame later.
			var displayWidth = pageEl.clientWidth || 600;
			var screenWidth = ( window.screen && window.screen.width ) || displayWidth;
			var targetCssWidth = Math.max( displayWidth, screenWidth / 2 );
			var targetDeviceWidth = Math.min( targetCssWidth * outputScale, MAX_RENDER_WIDTH );

			var renderScale = targetDeviceWidth / baseViewport.width;
			var viewport = page.getViewport( { scale: renderScale } );

			var canvas = document.createElement( 'canvas' );
			canvas.width = Math.floor( viewport.width );
			canvas.height = Math.floor( viewport.height );
			pageEl.appendChild( canvas );

			// Surface render failures: page.render() reports errors on its
			// returned promise, so without this a failed render is silent and
			// just shows as a blank page.
			page.render( {
				canvasContext: canvas.getContext( '2d' ),
				viewport: viewport,
			} ).promise.catch( function ( err ) {
				// eslint-disable-next-line no-console
				console.error( 'Annual Report Flipbook: failed to render page ' + pageNumber, err );
			} );

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
