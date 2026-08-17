/**
 * Frontend + admin-preview flipbook viewer.
 * Renders a PDF (via PDF.js) into page elements and creates page-turn
 * animation + UI chrome ( StPageFlip). Exposes window.ArfbFlipbook
 * so the admin uploader can (re)initialize a preview after upload.
 *
 * Requires, loaded before this file:
 *   - PDF.js core build          -> window.pdfjsLib
 *   - StPageFlip browser build   -> window.St.PageFlip
 *   - arfbConfig (wp_localize_script): { pdfWorkerSrc, i18n }
 *
 * Classes:
 *   ZoomController  zoom/pan state and the pointer gestures that drive them
 *   PageRenderer    PDF page -> canvas, at the right resolution, lazily
 *   LinkNavigator   in-document links: filtering, the PDF.js link service
 *   ViewerChrome    all the DOM furniture: toolbar, arrows, status, live region
 *   FlipbookInstance  the orchestrator that owns StPageFlip and wires the above
 *
 * The four collaborators never reference each other directly — everything goes
 * through callbacks handed in by the orchestrator. That is what makes each one
 * readable (and changeable) on its own.
 */
( function ( window, document ) {
	'use strict';

	// WordPress fills in this object for us — see wp_localize_script() in
	// includes/block.php. It carries the PDF worker path and the button labels,
	// already translated. "t" is just a short name for those labels.
	//
	// preview.html sends an empty list of labels, so every label below also has a
	// plain English default written after "||". If you reword one, reword both.
	const config = window.arfbConfig || { pdfWorkerSrc: '', i18n: {} };
	const t = config.i18n || {};

	// PDF.js does its heavy work in a background thread (a "web worker") so the
	// page stays responsive.
	// Pass PDF.js the path to the worker file. Otherwise, PDF.js does everything on the main
	// thread instead, which makes the page-turn animation stutter.
	if ( window.pdfjsLib && config.pdfWorkerSrc ) {
		window.pdfjsLib.GlobalWorkerOptions.workerSrc = config.pdfWorkerSrc;
	}

	// TUNING CONSTANTS: These constants are tuned for the StPageFlip defaults

	// Pre-render this number of pages before and after the current page
	// makes page turns feel smooth
	const PAGES_AROUND_CURRENT = 2;

	// Upper bound on a single page's rendered canvas width, in device pixels.
	// Pages are rendered high-res and downscaled by CSS so they stay crisp when
	// enlarged (e.g. fullscreen); this cap keeps canvases from getting enormous
	// on very high-resolution / 4K displays.
	const MAX_RENDER_WIDTH = 2400;

	// Higher cap used when a page is zoomed in, so its canvas is re-rendered
	// with enough real pixels to stay sharp at magnification (memory for these
	// larger canvases is reclaimed when the zoom is reset).
	const MAX_RENDER_WIDTH_ZOOM = 3000;

	// Maximum magnification for the zoom gesture and the +/- buttons
	// Each zoom button increases/decreases by ZOOM_STEP times
	const MAX_ZOOM = 4;
	const ZOOM_STEP = 1.5;

	// Minimum gap between two wheel-driven page turns, so one flick of a
	// trackpad doesn't fire a dozen flips.
	const WHEEL_FLIP_COOLDOWN = 300; // ms

	// How long the zoom gesture has to be still before we re-render the visible
	// pages at the magnified resolution.
	const ZOOM_RERENDER_DELAY = 180;

	// defines the layers that need to be cleaned up when a page is re-rendered
	const STALE_LAYERS = 'canvas, .arfb-page__text-layer, .arfb-page__annotation-layer';

	/**
	 * Drop the canvas and every overlay aligned to it. They are each sized for
	 * one particular render scale, so they have to go together — a leftover
	 * overlay sits misaligned over the new canvas, and for the annotation layer
	 * that means invisible click targets in the wrong places.
	 *
	 * @param {HTMLElement} pageEl - The page shell to strip.
	 * @returns {void}
	 */
	const removeStaleLayers = ( pageEl ) => {
		pageEl.querySelectorAll( STALE_LAYERS ).forEach( ( el ) => el.remove() );
	};

	/**
	 * Build a small inline SVG icon from a single path, inheriting currentColor.
	 * SVG icon helper used in the toolbar and nav buttons.
	 *
	 * @param {string} path - The `d` attribute for the icon's path.
	 * @param {number} [strokeWidth=2] - Stroke width, in viewBox units.
	 * @returns {string} Markup for an <svg> element, ready to assign to innerHTML.
	 */
	const arfbIcon = ( path, strokeWidth = 2 ) =>
		`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
		`<path d="${ path }" fill="none" stroke="currentColor" stroke-width="${ strokeWidth }" ` +
		`stroke-linecap="round" stroke-linejoin="round"/></svg>`;

	/**
	 * Filters outexternal links. 
	 * 
	 * Takes in a PDF.js annotation object and returns true if it is an internal link 
	 * (dest or named action) or false if it is an external link (url or unsafeUrl).
	 *
	 * A contents page printed in the PDF navigates by "destination" (dest) or by
	 * a named action such as NextPage — both resolved against the document, both
	 * kept. Anything carrying a URL is a jump out of the report: web addresses,
	 * mailto:, tel:, and also javascript:, which the annotation layer would
	 * otherwise place in the host page's DOM. Those are dropped here so no <a>
	 * is created for them at all, rather than rendered and left inert — an
	 * anchor with no href still shows a pointer cursor and swallows the click
	 * that would have turned the page.
	 *
	 * unsafeUrl is checked alongside url because PDF.js only populates url once
	 * a target has passed its own validation; the raw string lands in unsafeUrl
	 * either way, so an external link rejected by PDF.js is still an external
	 * link and still goes.
	 *
	 * @param {object} annotation - A PDF.js annotation object.
	 * @returns {boolean} True to keep the annotation, false to drop it.
	 */
	const arfbInternalOnly = ( annotation ) => {
		if ( ! annotation ) {
			return false;
		}
		if ( annotation.url || annotation.unsafeUrl ) {
			return false;
		}
		return true;
	};

	/**
	 * Handles zoom, pan, and the pointer gestures that drive them.
	 *
	 * Owns the transform applied to the pages element and nothing else — it has
	 * no idea pages are made of PDF canvases. When a zoom settles, or drops back
	 * to fit, it says so through onSettled / onReset and lets the orchestrator
	 * decide what that means for rendering.
	 *
	 * Mouse-wheel / trackpad behaviour over the book:
	 *   - plain scroll  → flip pages (down/right = next, up/left = prev)
	 *   - Ctrl/Cmd+scroll or a trackpad pinch (reported as a ctrl-wheel event)
	 *     → zoom in/out, anchored at the pointer
	 * When zoomed in, drag to pan; turning the page or double-clicking resets
	 * the zoom. Zooming scales the already high-resolution canvas, so pages
	 * stay crisp.
	 */
	class ZoomController {
		/**
		 * @param {object} options
		 * @param {HTMLElement} options.stage - Outer container; the wheel gesture listens here.
		 * @param {HTMLElement} options.viewerEl - Inner pages element; the transform is applied here.
		 * @param {() => boolean} options.isReady - Whether the book is ready for gestures.
		 * @param {() => void} options.onNext - Turn to the next page.
		 * @param {() => void} options.onPrev - Turn to the previous page.
		 * @param {( scale: number ) => void} options.onSettled - A zoom gesture has stopped at this scale.
		 * @param {() => void} options.onReset - Zoom is back at fit; canvases can be reclaimed.
		 */
		constructor( { stage, viewerEl, isReady, onNext, onPrev, onSettled, onReset } ) {
			this.stage = stage; // the outer container
			this.viewerEl = viewerEl; // inner pages element
			this.isReady = isReady; // called to check if the book is ready for gestures (e.g. StPageFlip has loaded)
			this.onNext = onNext;
			this.onPrev = onPrev;
			this.onSettled = onSettled; // called after a zoom gesture settles, so the orchestrator can re-render at the right resolution
			this.onReset = onReset;

			// zoom/pan state: scale and translation applied to the pages element.
			this.scale = 1;
			// pan offset 
			this.tx = 0;
			this.ty = 0;
			this.dragging = false; // true while the user is dragging to pan
			// pointer position when the drag begins
			this.startX = 0;
			this.startY = 0;
			// the pan offset when the drag begins
			this.baseTx = 0;
			this.baseTy = 0;

			this._timer = null;
			this._lastFlip = 0;

			this._bindGestures();
		}

		 /**
		 * Listens for pointer gestures that drive zoom and pan. Wheel/pinch zooms
		 *
		 * @returns {void}
		 */
		_bindGestures() {
			this.stage.addEventListener( 'wheel', ( e ) => this._onWheel( e ), { passive: false } );

			// Drag to pan while zoomed in. Capture-phase mousedown + stopPropagation
			// keeps StPageFlip (mouse-driven) from treating the drag as a page turn;
			// at scale 1 we don't interfere, so normal flipping/dragging still works.
			this.viewerEl.addEventListener( 'mousedown', ( e ) => {
				if ( this.scale <= 1 ) { // do nothing if not zoomed in
					return;
				}
				e.preventDefault();
				e.stopPropagation(); // prevent StPageFlip from treating the drag as a page turn
				// capture the pointer position and pan offset at the start of the drag
				this.dragging = true;
				this.startX = e.clientX;
				this.startY = e.clientY;
				this.baseTx = this.tx;
				this.baseTy = this.ty;
				this.viewerEl.classList.add( 'arfb-flipbook__pages--grabbing' );
			}, true );

			// Kept as fields so a teardown can detach them: these two are on
			// window (a drag that leaves the book still has to track and release),
			// so they outlive the viewer element unless removed explicitly.
			this._onWindowMouseMove = ( e ) => {
				if ( ! this.dragging ) {
					return;
				}
				// compute the new pan offset from the pointer's delta since the drag began
				this.tx = this.baseTx + ( e.clientX - this.startX );
				this.ty = this.baseTy + ( e.clientY - this.startY );
				this.apply();
			};
			this._onWindowMouseUp = () => { // release the drag
				if ( this.dragging ) {
					this.dragging = false;
					this.viewerEl.classList.remove( 'arfb-flipbook__pages--grabbing' );
				}
			};
			window.addEventListener( 'mousemove', this._onWindowMouseMove );
			window.addEventListener( 'mouseup', this._onWindowMouseUp );

			// Double-click snaps back to fit.
			this.viewerEl.addEventListener( 'dblclick', ( e ) => {
				if ( this.scale > 1 ) {
					e.preventDefault();
					this.onReset();
				}
			} );
		}

		/**
		 * Handles a wheel event over the book. 
		 * Ctrl/Cmd+wheel or a trackpad pinch -- zooms in/out 
		 * Plain zoom -- flips pages (down/right = next, up/left = prev)
		 * 
		 * @param {WheelEvent} e
		 * @returns {void}
		 */
		_onWheel( e ) {
			if ( ! this.isReady() ) {
				return;
			}

			// --- Zoom gesture: Ctrl/Cmd + wheel, or trackpad pinch ---
			if ( e.ctrlKey || e.metaKey ) {
				e.preventDefault();
				// Zoom is anchored at the pointer. sensitivity constant: 0.0015 
				this.zoomBy( Math.exp( -e.deltaY * 0.0015 ), e.clientX, e.clientY );
				return;
			}

			// --- Plain scroll: flip pages ---
			// Use whichever axis moved more (covers horizontal trackpads).
			const delta = Math.abs( e.deltaY ) >= Math.abs( e.deltaX ) ? e.deltaY : e.deltaX;
			if ( Math.abs( delta ) < 4 ) {
				return;
			}
			e.preventDefault();

			// Throttle page flips
			const now = Date.now();
			if ( now - this._lastFlip < WHEEL_FLIP_COOLDOWN ) {
				return;
			}
			this._lastFlip = now;

			if ( delta > 0 ) { // scroll down/right = next page
				this.onNext();
			} else { // scroll up/left = previous page
				this.onPrev();
			}
		}

		/**
		 * Zoom by a multiplicative factor, keeping a screen point fixed. Defaults to
		 * the centre of the book (used by the +/- toolbar buttons); the wheel/pinch
		 * gesture passes the pointer position. Shared so both behave identically.
		 *
		 * @param {number} factor - Multiplier applied to the current scale; >1 zooms in.
		 * @param {number} [clientX] - Viewport x to anchor on. Omit for the book's centre.
		 * @param {number} [clientY] - Viewport y to anchor on. Omit for the book's centre.
		 * @returns {void}
		 */
		zoomBy( factor, clientX, clientY ) {
			const rect = this.viewerEl.getBoundingClientRect();
			const anchorX = clientX == null ? rect.left + rect.width / 2 : clientX;
			const anchorY = clientY == null ? rect.top + rect.height / 2 : clientY;

			const newScale = Math.min( MAX_ZOOM, Math.max( 1, this.scale * factor ) );

			// Back to fit — hand off so the caller can also reclaim the
			// zoom-resolution canvases.
			if ( newScale === 1 ) {
				this.onReset();
				return;
			}

			// Keep the anchor point under the same screen position after scaling.
			const px = ( anchorX - rect.left ) / this.scale;
			const py = ( anchorY - rect.top ) / this.scale;
			this.tx += ( anchorX - px * newScale ) - rect.left;
			this.ty += ( anchorY - py * newScale ) - rect.top;
			this.scale = newScale;
			this.apply();
			this._scheduleRerender();
		}

		/**
		 * Apply the current scale and translation to the pages element.
		 *
		 * @returns {void}
		 */
		apply() {
			const zoomed = this.scale > 1;
			this.viewerEl.style.transformOrigin = '0 0';
			this.viewerEl.style.transform = zoomed
				? `translate(${ this.tx }px,${ this.ty }px) scale(${ this.scale })`
				: '';
			this.viewerEl.classList.toggle( 'arfb-flipbook__pages--zoomed', zoomed );
		}

		/**
		 * Transform back to identity. Does not touch canvases — see _resetZoom().
		 *
		 * @returns {void}
		 */
		reset() {
			this.scale = 1;
			this.tx = 0;
			this.ty = 0;
			this.apply();
			this.cancelPending();
		}

		/**
		 * Cancel a re-render that was scheduled but hasn't fired yet.
		 *
		 * @returns {void}
		 */
		cancelPending() {
			if ( this._timer ) {
				clearTimeout( this._timer );
				this._timer = null;
			}
		}

		/**
		 * After a zoom gesture settles, tell the orchestrator to re-render at a
		 * resolution matching the magnified size so text is as sharp as the source
		 * PDF. Debounced so it fires once the wheel/pinch stops, not every tick.
		 *
		 * @returns {void}
		 */
		_scheduleRerender() {
			this.cancelPending();
			this._timer = setTimeout( () => {
				this._timer = null;
				this.onSettled( this.scale );
			}, ZOOM_RERENDER_DELAY );
		}
	}

	/**
	 * Paints PDF pages onto canvases and keeps track of what has been drawn at
	 * what resolution.
	 *
	 * Deliberately knows nothing about zoom: the current scale arrives as an
	 * argument to render(), not as a reference to the ZoomController. That is
	 * what makes the resolution maths testable on its own.
	 *
	 * Pages are rendered lazily, near the current spread rather than the whole
	 * document up front, which matters for a long annual report.
	 */
	class PageRenderer {
		/**
		 * @param {object} options
		 * @param {object} options.pdfDoc - The PDF.js document proxy.
		 * @param {HTMLElement[]} options.pageEls - Page shells, in document order.
		 * @param {( page: object, viewport: object, pageEl: HTMLElement, overlayTransform: string ) => void} options.onPagePainted
		 *   Called once a page's canvas is in the DOM, so overlays can be added on top.
		 */
		constructor( { pdfDoc, pageEls, onPagePainted } ) {
			this.pdfDoc = pdfDoc;
			this.pageEls = pageEls;
			this.onPagePainted = onPagePainted;

			this.rendered = {};
			this.renderedWidth = {}; // device-px width each page was last rendered at
			this.zoomedPages = {}; // pages currently rendered at zoom resolution
		}

		/**
		 * Renders a range of pages. Indexes outside the document are clamped, so
		 * callers can ask for a window around a page without checking the edges.
		 *
		 * @param {number} startIndex - The index of the first page to render (0-based).
		 * @param {number} endIndex - The index of the last page to render (0-based).
		 * @param {object} [options] - Options for rendering, including zoom level and force flag.
		 * @param {number} [options.zoom=1] - Current magnification.
		 * @param {boolean} [options.force=false] - Re-render even if already painted.
		 * @returns {void}
		 */
		renderRange( startIndex, endIndex, options ) {
			const start = Math.max( 0, startIndex );
			const end = Math.min( this.pageEls.length - 1, endIndex );
			for ( let i = start; i <= end; i++ ) {
				this.render( i + 1, options ); // PDF.js pages are 1-indexed
			}
		}

		/**
		 * Renders pages around the current page, PAGES_AROUND_CURRENT either side,
		 * so the next flip lands on a page that is already painted.
		 *
		 * @param {number} index - The index of the current page (0-based).
		 * @param {object} [options] - Options for rendering, including zoom level and force flag.
		 * @param {number} [options.zoom=1] - Current magnification.
		 * @param {boolean} [options.force=false] - Re-render even if already painted.
		 * @returns {void}
		 */
		renderAround( index, options ) {
			this.renderRange( index - PAGES_AROUND_CURRENT, index + PAGES_AROUND_CURRENT, options );
		}

		/**
		 * Renders a single page at the requested zoom level, if it hasn't already
		 * been rendered at that resolution. If the page is already rendered at a	
		 * resolution equal to or higher than the requested zoom, it will not be re-rendered unless the force option is set to true.
		 * 
		 * @param {number} pageNumber - The page number to render (1-based).
		 * @param {object} [options] - Options for rendering, including zoom level and force flag.
		 * @param {number} [options.zoom=1] - Current magnification; raises the resolution cap above 1.
		 * @param {boolean} [options.force=false] - Consider a repaint even if the page is already painted.
		 * @returns {void} Painting itself is async and not awaited — see _paint().
		 */
		render( pageNumber, { zoom = 1, force = false } = {} ) {
			const pageEl = this.pageEls[ pageNumber - 1 ];
			if ( ! pageEl ) {
				return;
			}
			const outputScale = window.devicePixelRatio || 1;

			// The page's current on-screen (CSS) width. May be small right now, but
			// the same page can be blown up much larger — a spread filling the screen
			// in fullscreen (~half the screen width per page), or magnified by zoom.
			// Render to enough device pixels to stay crisp; a high-res canvas
			// downscaled by CSS (see the .arfb-page canvas rule) looks sharp at any
			// display size, which also sidesteps StPageFlip re-sizing a frame later.
			const displayWidth = pageEl.clientWidth || 600;
			const screenWidth = ( window.screen && window.screen.width ) || displayWidth;
			const targetCssWidth = Math.max( displayWidth, screenWidth / 2 );
			const cap = zoom > 1 ? MAX_RENDER_WIDTH_ZOOM : MAX_RENDER_WIDTH;
			const targetDeviceWidth = Math.min( targetCssWidth * outputScale * zoom, cap );

			// Skip if already rendered and either unforced, or already sharp enough
			// for the requested size.
			if ( this.rendered[ pageNumber ] && ! force ) {
				return;
			}
			if ( this.rendered[ pageNumber ] && ( this.renderedWidth[ pageNumber ] || 0 ) >= targetDeviceWidth - 1 ) {
				return;
			}

			// Marked before the async work starts, so a second call for the same
			// page can't race in and paint it twice.
			this.rendered[ pageNumber ] = true;
			this.renderedWidth[ pageNumber ] = targetDeviceWidth;
			if ( targetDeviceWidth > MAX_RENDER_WIDTH ) {
				this.zoomedPages[ pageNumber ] = true;
			} else {
				delete this.zoomedPages[ pageNumber ];
			}

			this._paint( pageNumber, pageEl, targetDeviceWidth, displayWidth );
		}

		/**
		 * Draw one page into a fresh canvas and swap it in, then build the overlays
		 * that have to line up with it. A failed paint is logged and un-marked so a
		 * later pass can retry.
		 *
		 * @param {number} pageNumber - The page number to paint (1-based).
		 * @param {HTMLElement} pageEl - The page shell to paint into.
		 * @param {number} targetDeviceWidth - Canvas width to render at, in device pixels.
		 * @param {number} displayWidth - Fallback CSS width if the shell reports none.
		 * @returns {Promise<void>}
		 */
		async _paint( pageNumber, pageEl, targetDeviceWidth, displayWidth ) {
			try {
				const page = await this.pdfDoc.getPage( pageNumber );
				const baseViewport = page.getViewport( { scale: 1 } );
				// compute render scale to match the target device width
				const renderScale = targetDeviceWidth / baseViewport.width;
				const viewport = page.getViewport( { scale: renderScale } );

				// Keep the old canvas visible and render into a detached canvas first, then swap it in once painted.
				// to avoid a blank flash when re-rendering at a new resolution
				// (e.g. after a zoom)
				const canvas = document.createElement( 'canvas' );
				canvas.width = Math.floor( viewport.width );
				canvas.height = Math.floor( viewport.height );

				await page.render( {
					canvasContext: canvas.getContext( '2d' ),
					viewport,
				} ).promise;

				removeStaleLayers( pageEl );
				pageEl.appendChild( canvas );

				// Both overlays below are built at the canvas's high-res scale and
				// then scaled down to the size the page is displayed at, so they
				// stay aligned with what's on screen.
				//
				// Scaled per axis, not uniformly, because the canvas itself is
				// not displayed at the PDF's aspect ratio: StPageFlip lays out
				// every page at the fixed size configured in _initPageFlip, and
				// the `.arfb-page canvas` rule stretches the bitmap to fill it.
				// A Letter-sized page in a taller page box is stretched ~8%
				// vertically, so an overlay scaled by width alone drifts further
				// off the further down the page you look — which for a link is
				// the difference between hitting it and missing it.
				const displayScale = ( pageEl.clientWidth || displayWidth ) / viewport.width;
				const displayScaleY = pageEl.clientHeight
					? pageEl.clientHeight / viewport.height
					: displayScale;
				const overlayTransform = `scale(${ displayScale },${ displayScaleY })`;

				// Clickable links. Stacked above the text layer by CSS z-index,
				// not by append order — both are appended from async callbacks
				// that can land in either order, and a text span on top of an
				// anchor would swallow the click.
				this.onPagePainted( page, viewport, pageEl, overlayTransform );

				// Not awaited: the text layer is an enhancement, and holding the
				// paint open for it would delay nothing useful.
				this._renderTextLayer( page, viewport, pageEl, overlayTransform );
			} catch ( err ) {
				// A failed render shouldn't leave the page permanently marked as
				// done — allow a later attempt to try again.
				this.rendered[ pageNumber ] = false;
				this.renderedWidth[ pageNumber ] = 0;
				// eslint-disable-next-line no-console
				console.error( `Annual Report Flipbook: failed to render page ${ pageNumber }`, err );
			}
		}

		/**
		 * PDF.js exposes the text separately from the rendered bitmap, so we
		 * create a DOM text layer here for selectable text and screen readers.
		 * Kept in sync with the PDF.js version pinned in assets/vendor/pdfjs. The
		 * text-layer entry point has moved across pdf.js releases (TextLayerBuilder
		 * vs renderTextLayer vs pdfjsLib.TextLayer) -- verify this against the
		 * exact version in assets/vendor/pdfjs before shipping.
		 *
		 * @param {object} page - The PDF.js page proxy.
		 * @param {object} viewport - The viewport the canvas was rendered at.
		 * @param {HTMLElement} pageEl - The page shell to append the layer to.
		 * @param {string} overlayTransform - CSS transform bringing the layer down to display size.
		 * @returns {Promise<void>} Resolves even when the text layer is unavailable.
		 */
		async _renderTextLayer( page, viewport, pageEl, overlayTransform ) {
			if ( typeof window.pdfjsLib.renderTextLayer !== 'function' ) {
				return;
			}
			try {
				// extract the text content for the page and render it into a div overlay
				const textContent = await page.getTextContent();

				const textLayerDiv = document.createElement( 'div' );
				textLayerDiv.className = 'arfb-page__text-layer';
				textLayerDiv.style.width = `${ viewport.width }px`;
				textLayerDiv.style.height = `${ viewport.height }px`;
				// PDF.js 3.x positions/sizes the text spans relative to this
				// CSS variable and errors to the console if it is missing.
				textLayerDiv.style.setProperty( '--scale-factor', String( viewport.scale ) );
				textLayerDiv.style.transform = overlayTransform;
				pageEl.appendChild( textLayerDiv );

				window.pdfjsLib.renderTextLayer( {
					textContentSource: textContent,
					container: textLayerDiv,
					viewport,
				} );
			} catch ( err ) {
				// Selectable text is an enhancement; the page still reads without it.
			}
		}

		/**
		 * Reclaim the large zoom-resolution canvases: drop them and let the normal
		 * lazy render redraw the visible pages at standard resolution. Returns
		 * whether anything was actually dropped, so the caller knows if a
		 * re-render is needed.
		 *
		 * @returns {boolean} True if any zoom-resolution canvas was dropped.
		 */
		discardZoomedPages() {
			const pages = Object.keys( this.zoomedPages );
			if ( ! pages.length ) {
				return false;
			}
			for ( const n of pages ) {
				const pageEl = this.pageEls[ n - 1 ];
				if ( pageEl ) {
					removeStaleLayers( pageEl );
				}
				this.rendered[ n ] = false;
				this.renderedWidth[ n ] = 0;
			}
			this.zoomedPages = {};
			return true;
		}
	}

	/**
	 * In-document links: which annotations survive, and what clicking one does.
	 *
	 * Navigation arrives as a `nav` object rather than a StPageFlip reference, so
	 * this class has no opinion about how a page turn is animated — it only says
	 * where to go.
	 */
	class LinkNavigator {
		/**
		 * @param {object} options
		 * @param {object} options.pdfDoc - The PDF.js document proxy.
		 * @param {object} options.nav - Navigation abstraction: goTo, next, prev, first, last.
		 */
		constructor( { pdfDoc, nav } ) {
			this.pdfDoc = pdfDoc;
			this.nav = nav;
		}

		/**
		 * Turn a PDF destination into a page turn, for the link annotations on a
		 * contents page printed inside the document.
		 *
		 * A destination is either an explicit array whose first entry is a reference
		 * to a page object, or the name of a destination that has to be looked up in
		 * the document first. Neither one is a page number, hence getPageIndex().
		 *
		 * @param {string|Array} dest - A named destination, or an explicit destination array.
		 * @returns {Promise<void>} Resolves without navigating if the destination is unusable.
		 */
		async goToDest( dest ) {
			try {
				// dest is either a named destination (string) or a page object.
				const target = typeof dest === 'string'
					? await this.pdfDoc.getDestination( dest )
					: dest;
				if ( ! target || ! target.length ) {
					return;
				}
				const index = await this.pdfDoc.getPageIndex( target[ 0 ] );
				this.nav.goTo( index );
			} catch ( err ) {
				// A destination pointing at nothing should do nothing, not throw.
			}
		}

		/**
		 * Takes the place of PDF.js's default link service.
		 *
		 * PDF.js draws link annotations but delegates every navigation decision to a
		 * "link service". The full implementation lives in PDF.js's own web viewer
		 * bundle (pdf_viewer.js), which we don't ship -- so this is just the part of
		 * that interface the annotation layer actually calls, pointed at the
		 * flipbook's page-turn animation instead of at scroll position.
		 *
		 * @returns {object} The subset of the PDF.js link service interface that the
		 *   annotation layer actually calls.
		 */
		linkService() {
			const { nav } = this;
			return {
				// PDF.js assigns this to href, then attaches its own click handler
				// that calls goToDestination() and returns false. No URL fragment
				// would mean anything here, so it stays empty and the handler does
				// all the work.
				getDestinationHash: () => '',

				getAnchorUrl: () => '',

				goToDestination: ( dest ) => this.goToDest( dest ),

				goToPage: ( pageNumber ) => nav.goTo( pageNumber - 1 ), // PDF page numbers are 1-based

				// Page-navigation buttons drawn inside the PDF itself.
				executeNamedAction: ( action ) => {
					if ( action === 'NextPage' ) {
						nav.next();
					} else if ( action === 'PrevPage' ) {
						nav.prev();
					} else if ( action === 'FirstPage' ) {
						nav.first();
					} else if ( action === 'LastPage' ) {
						nav.last();
					}
				},

				// Optional-content group toggles are used for Layers in PDFs.
				// This viewer doesn't support them.
				// This method is here because PDF.js would throw an error otherwise
				executeSetOCGState: () => {},

				// Called for links that point outside the document to let you set
				// href, target, rel, etc. This viewer doesn't support them.
				addLinkAttributes: () => {},
			};
		}

		/**
		 * Overlay a page's link annotations as real <a> elements, so a contents page
		 * printed inside the PDF becomes clickable and jumps the book to the right
		 * spread. Without this those links are just pixels on the canvas.
		 *
		 * Only links that stay inside the report are honoured. See arfbInternalOnly
		 * above for why external ones are dropped rather than rendered.
		 *
		 * PDF.js positions each annotation against the render viewport, so the layer
		 * is built at the canvas's scale and then brought down to display size by the
		 * same transform as the text layer — which is what keeps the click targets
		 * over the words they belong to, at any zoom level.
		 *
		 * @param {object} page - The PDF.js page proxy.
		 * @param {object} viewport - The viewport the canvas was rendered at.
		 * @param {HTMLElement} pageEl - The page shell to append the layer to.
		 * @param {string} overlayTransform - CSS transform bringing the layer down to display size.
		 * @returns {Promise<void>} Resolves without adding a layer if the page has no internal links.
		 */
		async renderAnnotations( page, viewport, pageEl, overlayTransform ) {
			// Missing from older PDF.js builds, same caveat as the text layer.
			if ( typeof window.pdfjsLib.AnnotationLayer !== 'function' ) {
				return;
			}

			let all;
			try {
				all = await page.getAnnotations( { intent: 'display' } );
			} catch ( err ) {
				return; // Annotations are optional; a page without them still reads fine.
			}
			if ( ! all || ! all.length ) {
				return;
			}

			const annotations = all.filter( arfbInternalOnly );

			// Most pages of a report have no internal links, and an empty overlay
			// would still sit on top of the canvas.
			if ( ! annotations.length ) {
				return;
			}

			const layerDiv = document.createElement( 'div' );
			// PDF.js styles the elements it creates off the annotationLayer
			// class; the arfb- one is ours, for positioning and teardown.
			layerDiv.className = 'annotationLayer arfb-page__annotation-layer';
			// PDF.js sizes the layer and everything inside it in terms of this
			// variable, so it has to be set before render() runs.
			layerDiv.style.setProperty( '--scale-factor', String( viewport.scale ) );
			layerDiv.style.transform = overlayTransform;
			pageEl.appendChild( layerDiv );

			try {
				await new window.pdfjsLib.AnnotationLayer( {
					div: layerDiv,
					page,
					viewport,
					annotationCanvasMap: null,
				} ).render( {
					annotations,
					linkService: this.linkService(),
					// Defaults to true. A report is for reading, so any form fields
					// stay as they were printed rather than becoming live inputs.
					renderForms: false,
				} );
			} catch ( err ) {
				// One unrenderable annotation shouldn't leave a half-built
				// overlay intercepting clicks.
				layerDiv.remove();
			}
		}
	}

	/**
	 * Everything the reader sees that isn't a page: the loading message, the
	 * screen-reader live region, the side arrows and the floating toolbar.
	 *
	 * Builds DOM and reports intent through `handlers`. It holds no viewer state
	 * of its own — the page number it displays is passed in, never derived.
	 */
	class ViewerChrome {
		/**
		 * @param {object} options
		 * @param {HTMLElement} options.container - The viewer's outermost element.
		 * @param {string} options.title - Accessible name for the viewer region.
		 * @param {string} options.pdfUrl - Target for the download button and the error fallback.
		 * @param {object} options.handlers - Intent callbacks: isReady, onNext, onPrev, onFirst,
		 *   onLast, onZoomIn, onZoomOut, onJump, onFullscreen.
		 */
		constructor( { container, title, pdfUrl, handlers } ) {
			this.container = container;
			this.title = title;
			this.pdfUrl = pdfUrl;
			this.handlers = handlers;

			this.statusEl = null;
			this.liveRegion = null;
			this.pageInput = null;
		}

		/**
		 * The part that exists before the PDF has loaded: loading message, live
		 * region, and the keyboard bindings for turning pages.
		 *
		 * @returns {void}
		 */
		buildInitial() {
			this.container.innerHTML = '';
			this.container.classList.add( 'arfb-flipbook--loading' );
			this.container.setAttribute( 'role', 'region' );
			this.container.setAttribute( 'aria-label', this.title );

			// Show a loading message while the PDF downloads.
			const status = document.createElement( 'p' );
			status.className = 'arfb-flipbook__status';
			status.textContent = t.loading || 'Loading…';
			this.container.appendChild( status );
			this.statusEl = status;

			// Live region for screen reader announcements.
			//  See announce() below for what goes in it.
			const live = document.createElement( 'div' );
			live.className = 'arfb-visually-hidden';
			live.setAttribute( 'aria-live', 'polite' );
			this.container.appendChild( live );
			this.liveRegion = live;

			// arrow keys, Home and End turn pages
			this.container.addEventListener( 'keydown', ( e ) => {
				const h = this.handlers;
				if ( ! h.isReady() ) {
					return;
				}
				if ( e.key === 'ArrowRight' ) {
					h.onNext();
				} else if ( e.key === 'ArrowLeft' ) {
					h.onPrev();
				} else if ( e.key === 'Home' ) {
					h.onFirst();
				} else if ( e.key === 'End' ) {
					h.onLast();
				} else {
					return;
				}
				e.preventDefault();
			} );
		}

		/**
		 * The controls, which need the page count and the stage to sit on.
		 *
		 * @param {object} options
		 * @param {HTMLElement} options.stage - Element the side arrows are overlaid on.
		 * @param {number} options.pageCount - Total pages, for the "/ N" label and input max.
		 * @returns {void}
		 */
		buildControls( { stage, pageCount } ) {
			this._buildNavArrows( stage );
			this._buildToolbar( pageCount );
		}

		/**
		 * Remove the loading message once the book is ready.
		 *
		 * @returns {void}
		 */
		removeStatus() {
			if ( this.statusEl ) {
				this.statusEl.remove();
			}
		}

		/**
		 * Previous / next page-turn controls, as arrow buttons overlaid on the
		 * left and right edges of the book.
		 *
		 * @param {HTMLElement} stage - Element to overlay the arrows on.
		 * @returns {void}
		 */
		_buildNavArrows( stage ) {
			/**
			 * @param {string} className - Modifier class for side and styling.
			 * @param {string} label - Accessible name and tooltip.
			 * @param {string} path - Icon path data.
			 * @param {() => void} onClick - Click handler.
			 * @returns {HTMLButtonElement} The button, already appended to the stage.
			 */
			const arrow = ( className, label, path, onClick ) => {
				const b = document.createElement( 'button' );
				b.type = 'button';
				b.className = `arfb-nav ${ className }`;
				b.setAttribute( 'aria-label', label );
				b.title = label;
				b.innerHTML = arfbIcon( path, 2.2 );
				b.addEventListener( 'click', onClick );
				stage.appendChild( b );
				return b;
			};

			arrow( 'arfb-nav--prev', t.previous || 'Previous page', 'M15 4 7 12l8 8', this.handlers.onPrev );
			arrow( 'arfb-nav--next', t.next || 'Next page', 'M9 4l8 8-8 8', this.handlers.onNext );
		}

		/**
		 * The floating toolbar: zoom buttons, the page box, fullscreen, download.
		 *
		 * @param {number} pageCount - Total pages, for the "/ N" label and the input's max.
		 * @returns {void}
		 */
		_buildToolbar( pageCount ) {
			const h = this.handlers;
			const toolbar = document.createElement( 'div' );
			toolbar.className = 'arfb-flipbook__toolbar';

			/**
			 * @param {string} className - Modifier class for styling.
			 * @param {string} label - Accessible name.
			 * @param {string} path - Icon path data.
			 * @param {() => void} onClick - Click handler.
			 * @returns {HTMLButtonElement} The button, already appended to the toolbar.
			 */
			const iconButton = ( className, label, path, onClick ) => {
				const b = document.createElement( 'button' );
				b.type = 'button';
				b.className = `arfb-btn ${ className }`;
				b.setAttribute( 'aria-label', label );
				b.innerHTML = arfbIcon( path );
				b.addEventListener( 'click', onClick );
				toolbar.appendChild( b );
				return b;
			};

			// Zoom controls.
			iconButton( 'arfb-btn--zoom-out', t.zoomOut || 'Zoom out', 'M5 12h14', h.onZoomOut );
			iconButton( 'arfb-btn--zoom-in', t.zoomIn || 'Zoom in', 'M12 5v14 M5 12h14', h.onZoomIn );

			// Page control: shows the current page as an editable field; type a
			// number and press Enter (or leave the field) to jump. "/ N" is the total.
			const pageControl = document.createElement( 'span' );
			pageControl.className = 'arfb-flipbook__page-control';

			const pageInput = document.createElement( 'input' );
			pageInput.type = 'number';
			pageInput.min = '1';
			pageInput.max = String( pageCount );
			pageInput.className = 'arfb-flipbook__page-input';
			pageInput.setAttribute( 'aria-label', t.goToPage || 'Go to page' );
			this.pageInput = pageInput;

			const pageTotal = document.createElement( 'span' );
			pageTotal.className = 'arfb-flipbook__page-total';
			pageTotal.textContent = `/ ${ pageCount }`;

			pageInput.addEventListener( 'keydown', ( e ) => {
				e.stopPropagation(); // keep arrow keys in the field from flipping pages
				if ( e.key === 'Enter' ) {
					e.preventDefault();
					h.onJump( pageInput.value );
					pageInput.blur();
				}
			} );
			pageInput.addEventListener( 'change', () => h.onJump( pageInput.value ) );

			pageControl.appendChild( pageInput );
			pageControl.appendChild( pageTotal );
			toolbar.appendChild( pageControl );

			iconButton(
				'arfb-btn--fullscreen',
				t.fullscreen || 'Toggle fullscreen',
				'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5',
				h.onFullscreen
			);

			const download = document.createElement( 'a' );
			download.className = 'arfb-btn arfb-btn--download';
			download.href = this.pdfUrl;
			download.setAttribute( 'download', '' );
			download.setAttribute( 'aria-label', t.download || 'Download PDF' );
			download.innerHTML = arfbIcon( 'M12 3v11 M8 11l4 4 4-4 M5 20h14' );
			toolbar.appendChild( download );

			// Appended (not inserted above the stage) so it overlays the viewer as a
			// floating bar — see the .arfb-flipbook__toolbar styles.
			this.container.appendChild( toolbar );
		}

		/**
		 * Error displaying the pdf. Show a message and a download link instead of the book.
		 *
		 * @param {Error} [err] - Logged to the console when present; the reader only sees the message.
		 * @returns {void}
		 */
		showError( err ) {
			if ( err ) {
				// eslint-disable-next-line no-console
				console.error( 'Annual Report Flipbook:', err );
			}
			this.container.classList.remove( 'arfb-flipbook--loading' );
			this.container.classList.add( 'arfb-flipbook--error' );

			// fallback message, a link to download the pdf, and a note pointing at
			// that link as the accessible way to read the report.
			this.container.innerHTML = '';

			const message = document.createElement( 'p' );
			message.className = 'arfb-flipbook__status';
			message.textContent = t.loadError || 'Sorry, the report could not be loaded.';
			this.container.appendChild( message );

			// Built as elements rather than an innerHTML string: pdfUrl comes off a
			// data attribute, and interpolating it into markup would make the error
			// screen only as safe as whoever set that attribute.
			const link = document.createElement( 'a' );
			link.href = this.pdfUrl;
			link.textContent = t.download || 'Download PDF';
			const linkWrap = document.createElement( 'p' );
			linkWrap.appendChild( link );
			this.container.appendChild( linkWrap );

			const note = document.createElement( 'p' );
			note.className = 'arfb-flipbook__note';
			note.textContent = t.accessibleNote ||
				'To view an accessible version of the report, download the PDF using the link above.';
			this.container.appendChild( note );
		}

		/**
		 * Put the current page number in the toolbar box, unless the reader is
		 * typing in it.
		 *
		 * @param {object} options
		 * @param {number} options.index - Current page index (0-based).
		 * @param {?number} options.requestedPage - Page number the reader typed, if any (1-based).
		 * @param {number} options.pageCount - Total pages, used to clamp a requested page.
		 * @returns {void}
		 */
		updateIndicator( { index, requestedPage, pageCount } ) {
			// Reflect the current page in the input, unless the user is typing in it.
			if ( ! this.pageInput || document.activeElement === this.pageInput ) {
				return;
			}

			if ( requestedPage != null ) {
				this.pageInput.value = String( Math.min( Math.max( requestedPage, 1 ), pageCount ) );
				return;
			}

			this.pageInput.value = String( index + 1 );
		}

		/**
		 * Write the reader's position into the live region for screen readers.
		 *
		 * @param {object} options
		 * @param {number} options.index - Current page index (0-based).
		 * @param {number} options.total - Total pages.
		 * @param {boolean} options.isSpread - Whether two pages are visible side by side.
		 * @returns {void}
		 */
		announce( { index, total, isSpread } ) {
			if ( ! this.liveRegion ) {
				return;
			}

			if ( isSpread ) {
				this.liveRegion.textContent = ( t.pagesOf || 'Pages %1$d–%2$d of %3$d' )
					.replace( '%1$d', index + 1 )
					.replace( '%2$d', index + 2 )
					.replace( '%3$d', total );
				return;
			}

			this.liveRegion.textContent = ( t.pageOf || 'Page %1$d of %2$d' )
				.replace( '%1$d', index + 1 )
				.replace( '%2$d', total );
		}
	}

	/**
	 * A viewer instance created for each PDF flipbook on the page.
	 *
	 * The container is the empty <div> WordPress puts on the page. Which PDF to
	 * show is read off it as a data-pdf-url attribute.
	 *
	 * This class owns the StPageFlip book and the page-change lifecycle, and
	 * wires the four collaborators to each other. It is the only place that
	 * knows about all of them.
	 */
	class FlipbookInstance {
		/**
		 * @param {HTMLElement} container - The block's empty <div>, carrying data-pdf-url
		 *   and data-title. Loading starts immediately.
		 */
		constructor( container ) {
			this.container = container;
			this.pdfUrl = container.getAttribute( 'data-pdf-url' );
			this.title = container.getAttribute( 'data-title' ) || '';
			this.pdfDoc = null;
			this.pageFlip = null;
			// The page number you typed into the toolbar box. We only hang onto it
			// until the flip finishes.
			// used when the user types a page number into the toolbar input box.
			this.requestedPage = null;
			this.currentIndex = 0;
			this.pageEls = [];
			this.reducedMotion = window.matchMedia && window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;

			// Built once the PDF has loaded — see _buildPageShells / _initPageFlip.
			this.renderer = null;
			this.zoom = null;
			this.links = null;

			this.chrome = new ViewerChrome( {
				container,
				title: this.title,
				pdfUrl: this.pdfUrl,
				handlers: {
					isReady: () => !! this.pageFlip,
					onNext: () => this.pageFlip && this.pageFlip.flipNext(),
					onPrev: () => this.pageFlip && this.pageFlip.flipPrev(),
					onFirst: () => this.pageFlip && this.pageFlip.flip( 0 ),
					onLast: () => this.pageFlip && this.pageFlip.flip( this.pageEls.length - 1 ),
					onZoomIn: () => this.zoom && this.zoom.zoomBy( ZOOM_STEP ),
					onZoomOut: () => this.zoom && this.zoom.zoomBy( 1 / ZOOM_STEP ),
					onJump: ( raw ) => this._jumpTo( raw ),
					onFullscreen: () => this._toggleFullscreen(),
				},
			} );

			this.chrome.buildInitial();
			this._load();
		}

		/**
		 * Open the PDF and build the book, showing the error screen if any step fails.
		 *
		 * @returns {Promise<void>}
		 */
		async _load() {
			// Error if PDF URL or PDF.js is missing
			if ( ! this.pdfUrl || ! window.pdfjsLib ) {
				this.chrome.showError();
				return;
			}

			// load the pdf
			//   1. download and open the PDF
			//   2. grab page 1 to measure its shape (tall or wide)
			//   3. build an empty placeholder for every page, all that same shape
			//   4. hand the placeholders to StPageFlip, which turns them into a book
			//
			// measure page 1 first so all the placeholders are the right size
			// before the book is built.
			try {
				this.pdfDoc = await window.pdfjsLib.getDocument( this.pdfUrl ).promise;
				const firstPage = await this.pdfDoc.getPage( 1 );
				this._buildPageShells( firstPage );

				if ( ! this._initPageFlip() ) {
					return;
				}
				this.container.classList.remove( 'arfb-flipbook--loading' );
				this.chrome.removeStatus();
			} catch ( err ) {
				this.chrome.showError( err );
			}
		}

		/**
		 * Create one lightweight placeholder <div class="arfb-page"> per PDF page,
		 * sized to the first page's aspect ratio. Actual canvas + text-layer content
		 * is filled in lazily by the renderer as the reader approaches each page.
		 * That keeps the initial load fast for long documents.
		 *
		 * @param {object} firstPage - PDF.js page 1, measured for the aspect ratio every
		 *   shell is given.
		 * @returns {void}
		 */
		_buildPageShells( firstPage ) {
			const viewport = firstPage.getViewport( { scale: 1 } );
			const aspect = viewport.height / viewport.width;

			// The stage wraps the page area and hosts the side arrows, so they can
			// be positioned against the book's edges without becoming children of
			// the StPageFlip-managed pages element.
			const stage = document.createElement( 'div' );
			stage.className = 'arfb-flipbook__stage';
			this.container.appendChild( stage );
			this.stage = stage;

			const viewerEl = document.createElement( 'div' );
			viewerEl.className = 'arfb-flipbook__pages';
			stage.appendChild( viewerEl );
			this.viewerEl = viewerEl;

			for ( let i = 1; i <= this.pdfDoc.numPages; i++ ) {
				const pageEl = document.createElement( 'div' );
				pageEl.className = 'arfb-page';
				pageEl.dataset.pageNumber = String( i );
				pageEl.style.aspectRatio = ( 1 / aspect ).toFixed( 4 );
				viewerEl.appendChild( pageEl );
				this.pageEls.push( pageEl );
			}

			this.links = new LinkNavigator( {
				pdfDoc: this.pdfDoc,
				nav: this._navigation(),
			} );

			this.renderer = new PageRenderer( {
				pdfDoc: this.pdfDoc,
				pageEls: this.pageEls,
				onPagePainted: ( page, vp, pageEl, transform ) =>
					this.links.renderAnnotations( page, vp, pageEl, transform ),
			} );

			this.chrome.buildControls( { stage, pageCount: this.pageEls.length } );
		}

		/**
		 * The navigation abstraction handed to LinkNavigator: "where to go",
		 * with no mention of how the turn is animated.
		 *
		 * @returns {object} An object of goTo/next/prev/first/last methods.
		 */
		_navigation() {
			return {
				goTo: ( index ) => {
					// Landing on a new page still magnified and panned somewhere
					// else is disorienting, so drop back to the full spread first.
					this._resetZoom( index );
					if ( this.pageFlip ) {
						this.pageFlip.flip( index );
					}
				},
				next: () => this.pageFlip && this.pageFlip.flipNext(),
				prev: () => this.pageFlip && this.pageFlip.flipPrev(),
				first: () => this.pageFlip && this.pageFlip.flip( 0 ),
				last: () => this.pageFlip && this.pageFlip.flip( this.pageEls.length - 1 ),
			};
		}

		/**
		 * Turn the page shells into a book: construct StPageFlip, subscribe to its
		 * events, and create the ZoomController now that the stage exists.
		 *
		 * @returns {boolean} True on success; false if StPageFlip is missing, in which
		 *   case the error screen has already been shown.
		 */
		_initPageFlip() {
			const PageFlip = window.St && window.St.PageFlip;

			if ( ! PageFlip ) {
				this.chrome.showError( new Error( 'StPageFlip not loaded' ) );
				return false;
			}

			const pageWidth = 600;
			const pageHeight = 848;

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

			// Runs every time a page is turned. We ask StPageFlip where it ended up
			// rather than reading the number off the event, because the event
			// sometimes reports the page that was turned instead of the one now on
			// screen — which would leave the toolbar showing the wrong number.
			this.pageFlip.on( 'flip', ( e ) => {
				const index = typeof this.pageFlip.getCurrentPageIndex === 'function'
					? this.pageFlip.getCurrentPageIndex()
					: ( e.data != null ? e.data : 0 );
				this._onPageChange( index );
			} );

			// Hide the static spine/gutter shadow while a page is folding or flipping
			// so it doesn't sit awkwardly over the animation
			this.pageFlip.on( 'changeState', ( e ) => {
				this.viewerEl.classList.toggle( 'arfb-flipbook__pages--flipping', e.data !== 'read' );
			} );

			// Kept as a field so a teardown can detach it: this one is on document,
			// so it outlives the container unless removed explicitly.
			this._fullscreenHandler = () => this._onFullscreenChange();
			document.addEventListener( 'fullscreenchange', this._fullscreenHandler );

			this.zoom = new ZoomController( {
				stage: this.stage,
				viewerEl: this.viewerEl,
				isReady: () => !! this.pageFlip,
				onNext: () => this.pageFlip.flipNext(),
				onPrev: () => this.pageFlip.flipPrev(),
				onReset: () => this._resetZoom(),
				onSettled: ( scale ) => this._rerenderAtZoom( scale ),
			} );

			this._onPageChange( 0 );
			return true;
		}

		/**
		 * Drop back to the full spread and, if any zoom-resolution canvases were
		 * being held, reclaim them and redraw at standard resolution.
		 *
		 * @param {number} [index] - Page index to redraw around. Defaults to wherever
		 *   StPageFlip currently is; pass it explicitly when resetting as part of a
		 *   turn, since StPageFlip hasn't moved yet at that point.
		 * @returns {void}
		 */
		_resetZoom( index ) {
			if ( ! this.zoom ) {
				return;
			}
			this.zoom.reset();

			if ( ! this.renderer || ! this.renderer.discardZoomedPages() ) {
				return;
			}

			const idx = typeof index === 'number' ? index : this._currentPageIndex();
			this.renderer.renderAround( idx );
		}

		/**
		 * Re-render the visible spread sharp enough for the current magnification.
		 *
		 * @param {number} scale - The settled zoom scale.
		 * @returns {void}
		 */
		_rerenderAtZoom( scale ) {
			if ( ! this.pageFlip || ! this.renderer ) {
				return;
			}
			const idx = this._currentPageIndex();
			this.renderer.renderRange( idx - 1, idx + 2, { zoom: scale, force: true } );
		}

		/**
		 * Where the book currently is, tolerating StPageFlip versions that don't
		 * expose the getter.
		 *
		 * @returns {number} The current page index (0-based), or 0 if unknown.
		 */
		_currentPageIndex() {
			return this.pageFlip && this.pageFlip.getCurrentPageIndex
				? this.pageFlip.getCurrentPageIndex()
				: 0;
		}

		/**
		 * Go to whatever page number is in the box. Numbers outside the document
		 * get pulled back into range, so typing 999 takes you to the last page
		 * rather than doing nothing.
		 *
		 * @param {string} rawValue - The raw contents of the page input.
		 * @returns {void}
		 */
		_jumpTo( rawValue ) {
			const n = parseInt( rawValue, 10 );
			if ( isNaN( n ) || ! this.pageFlip ) {
				this.requestedPage = null;
				this._updateIndicator( this.currentIndex || 0 ); // put the real page number back
				return;
			}

			// Remembering the number you typed stops the box flipping back on its
			// own: the book shows two pages side by side, and StPageFlip only tells
			// us the left one. Type 3 and it lands on the 2-3 pair, then reports "2".
			this.requestedPage = Math.min( Math.max( n, 1 ), this.pageEls.length );
			// Page numbers start at 1 for readers, but index 0 in the code.
			const target = this.requestedPage - 1;

			// StPageFlip has called this method different things in different
			// versions, so we check each name and use whichever one this copy has.
			// flip() is the last resort: every version has it, but it jumps
			// straight to the page with no turning animation.
			if ( typeof this.pageFlip.turnToPage === 'function' ) {
				this.pageFlip.turnToPage( target );
			} else if ( typeof this.pageFlip.flipToPage === 'function' ) {
				this.pageFlip.flipToPage( target );
			} else if ( typeof this.pageFlip.show === 'function' ) {
				this.pageFlip.show( target );
			} else {
				this.pageFlip.flip( target );
			}
		}

		/**
		 * Enter fullscreen on the viewer, or leave it if already there.
		 *
		 * @returns {void}
		 */
		_toggleFullscreen() {
			if ( document.fullscreenElement ) {
				document.exitFullscreen();
			} else if ( this.container.requestFullscreen ) {
				this.container.requestFullscreen();
			}
		}

		/**
		 * Keep the spread fitting inside the viewport when fullscreen. At full
		 * screen width StPageFlip would derive a spread height taller than the
		 * screen, so we cap the viewer width to whatever keeps the height within
		 * the space left below the toolbar, then let StPageFlip re-measure.
		 *
		 * @returns {void}
		 */
		_onFullscreenChange() {
			const isFullscreen = document.fullscreenElement === this.container;

			if ( isFullscreen ) {
				// Space above the pages (the toolbar) plus a little breathing room.
				const chromeHeight = this.stage.offsetTop;
				const availableHeight = this.container.clientHeight - chromeHeight - 12;
				// The stage's side gutters (room for the arrows) don't hold the book,
				// so add them back in: cap so the BOOK — not the padded stage — fills
				// the available height, using as much of the screen as possible.
				const cs = window.getComputedStyle( this.stage );
				const padX = ( parseFloat( cs.paddingLeft ) || 0 ) + ( parseFloat( cs.paddingRight ) || 0 );
				const maxWidth = ( availableHeight / this.spreadHeightRatio ) + padX;
				this.stage.style.maxWidth = `${ Math.floor( maxWidth ) }px`;
				this.stage.style.marginLeft = 'auto';
				this.stage.style.marginRight = 'auto';
			} else {
				this.stage.style.maxWidth = '';
				this.stage.style.marginLeft = '';
				this.stage.style.marginRight = '';
			}

			// Let StPageFlip recompute its geometry against the new container size.
			// (rAF so the fullscreen layout has settled before it measures.)
			window.requestAnimationFrame( () => {
				window.dispatchEvent( new Event( 'resize' ) );
			} );
		}

		/**
		 * Everything that has to happen when the book lands on a new page. Also run
		 * once at startup, for page 0.
		 *
		 * @param {number} index - The page index now on screen (0-based).
		 * @returns {void}
		 */
		_onPageChange( index ) {
			this.currentIndex = index;
			this._resetZoom( index );       // a page you just turned to always starts unzoomed
			this._updateIndicator( index ); // this still needs requestedPage, so clear it after
			this.requestedPage = null;
			this.renderer.renderAround( index ); // draw the neighbouring pages, ready for the next flip
			this._announce( index );        // tell screen readers where we are

			const isPageSingle = ( index === 0 ) || ( index === this.pageEls.length - 1 );
			this.viewerEl.classList.toggle( 'arfb-flipbook__pages--single', isPageSingle );
		}

		/**
		 * Hand the chrome what it needs to show the right number in the page box.
		 *
		 * @param {number} index - The current page index (0-based).
		 * @returns {void}
		 */
		_updateIndicator( index ) {
			this.chrome.updateIndicator( {
				index,
				requestedPage: this.requestedPage,
				pageCount: this.pageEls.length,
			} );
		}

		/**
		 * Work out whether the reader is looking at one page or a spread, then let
		 * the chrome announce it.
		 *
		 * @param {number} index - The current page index (0-based).
		 * @returns {void}
		 */
		_announce( index ) {
			const total = this.pageEls.length;

			// In landscape the viewer shows a two-page spread, so naming only the
			// left page misleads: a reader who jumps to page 3 lands on the 2-3
			// spread and would otherwise hear "Page 2 of 10". With showCover, the
			// first and last pages stand alone, so only announce a spread when both
			// of its pages are interior ones.
			const orientation = ( this.pageFlip && typeof this.pageFlip.getOrientation === 'function' )
				? this.pageFlip.getOrientation()
				: 'landscape';
			const isSpread = orientation !== 'portrait' && index >= 1 && index + 3 <= total;

			this.chrome.announce( { index, total, isSpread } );
		}
	}

	/**
	 * Public API
	 */
	const ArfbFlipbook = {
		instances: {},

		/**
		 * Create a viewer for one container, unless it already has one.
		 *
		 * @param {HTMLElement} container - The block's container element.
		 * @returns {FlipbookInstance|undefined} The new instance, or undefined if the
		 *   container was missing or already initialized.
		 */
		init( container ) {
			if ( ! container || container.arfbInitialized ) {
				return;
			}
			container.arfbInitialized = true;
			const instance = new FlipbookInstance( container );
			this.instances[ container.id ] = instance;
			return instance;
		},

		/**
		 * Point an existing container at a different PDF and rebuild it. Used by the
		 * admin uploader to refresh the preview after an upload.
		 *
		 * @param {HTMLElement} container - The container to rebuild.
		 * @param {string} pdfUrl - URL of the PDF to show instead.
		 * @returns {void}
		 */
		reload( container, pdfUrl ) {
			container.arfbInitialized = false;
			container.setAttribute( 'data-pdf-url', pdfUrl );
			delete this.instances[ container.id ];
			this.init( container );
		},

		/**
		 * Initialize every flipbook block on the page that has a PDF to show.
		 *
		 * @returns {void}
		 */
		initAll() {
			const els = document.querySelectorAll( '.arfb-flipbook:not([data-pdf-url=""])' );
			els.forEach( ( el ) => {
				if ( el.getAttribute( 'data-pdf-url' ) ) {
					this.init( el );
				}
			} );
		},
	};

	window.ArfbFlipbook = ArfbFlipbook;

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', () => ArfbFlipbook.initAll() );
	} else {
		ArfbFlipbook.initAll();
	}
} )( window, document );

// 3.32
