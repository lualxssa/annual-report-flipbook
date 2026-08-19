<?php
/**
 * Gutenberg block + shortcode for embedding the flipbook, and the shared
 * asset-enqueueing used by both the public-facing viewer and the admin preview.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Enqueue the PDF.js + StPageFlip + glue JS/CSS bundle.
 * Safe to call multiple times; WordPress dedupes registered handles.
 */
function arfb_enqueue_viewer_assets() {
	// PDF.js (UMD build). Tell it where its worker script lives.
	wp_enqueue_script(
		'pdfjs-lib',
		ARFB_PLUGIN_URL . 'assets/vendor/pdfjs/pdf.min.js',
		array(),
		ARFB_VERSION,
		true
	);

	wp_enqueue_script(
		'stpageflip',
		ARFB_PLUGIN_URL . 'assets/vendor/pageflip/page-flip.browser.js',
		array(),
		ARFB_VERSION,
		true
	);

	// The array here lists what this script depends on 
	wp_enqueue_script(
		'arfb-flipbook',
		ARFB_PLUGIN_URL . 'assets/js/flipbook.js',
		array( 'pdfjs-lib', 'stpageflip' ),
		ARFB_VERSION,
		true
	);

	wp_localize_script(
		'arfb-flipbook',
		'arfbConfig',
		array(
			'pdfWorkerSrc' => ARFB_PLUGIN_URL . 'assets/vendor/pdfjs/pdf.worker.min.js',
			'i18n'         => array(
				'pageOf'       => __( 'Page %1$d of %2$d', 'annual-report-flipbook' ),
				'pagesOf'      => __( 'Pages %1$d–%2$d of %3$d', 'annual-report-flipbook' ),
				'next'         => __( 'Next page', 'annual-report-flipbook' ),
				'previous'     => __( 'Previous page', 'annual-report-flipbook' ),
				'fullscreen'   => __( 'Toggle fullscreen', 'annual-report-flipbook' ),
				'download'     => __( 'Download PDF', 'annual-report-flipbook' ),
				'tableOfContents' => __( 'Table of contents', 'annual-report-flipbook' ),
				'loading'      => __( 'Loading report…', 'annual-report-flipbook' ),
				'loadError'    => __( 'Sorry, the report could not be loaded.', 'annual-report-flipbook' ),
				// Shown under the download link on the error screen. Kept generic so it
				// is correct whichever PDF the site has uploaded — the link above it
				// already points at the file itself.
				'accessibleNote' => __( 'To view an accessible version of the report, download the PDF using the link above.', 'annual-report-flipbook' ),
			),
		)
	);

	wp_enqueue_style(
		'arfb-flipbook-style',
		ARFB_PLUGIN_URL . 'assets/css/flipbook.css',
		array(),
		ARFB_VERSION
	);
}

/**
 * Sanitize a user-supplied width into a safe CSS length, or '' if invalid.
 * Accepts a bare number (treated as px) or a value with a px/%/rem/em/vw unit.
 *
 * @param string|int $value Raw width value.
 * @return string Safe CSS length (e.g. "600px", "100%") or '' to fall back to the default.
 */
function arfb_sanitize_css_width( $value ) {
	$value = trim( (string) $value );

	if ( '' === $value ) {
		return '';
	}
	if ( is_numeric( $value ) ) {
		return absint( $value ) . 'px';
	}
	if ( preg_match( '/^\d+(\.\d+)?(px|%|rem|em|vw)$/', $value ) ) {
		return $value;
	}

	return '';
}

/**
 * Map a size preset (or a custom value) to a CSS max-width.
 *
 * @param string $size   One of small|medium|large|full|custom.
 * @param string $custom Custom width, used only when $size is "custom".
 * @return string CSS length/percent, or '' to use the stylesheet default.
 */
function arfb_resolve_width( $size, $custom = '' ) {
	switch ( $size ) {
		case 'small':
			return '600px';
		case 'medium':
			return '900px';
		case 'large':
			return '1200px';
		case 'full':
			return '100%';
		case 'custom':
			return arfb_sanitize_css_width( $custom );
	}
	return '';
}

/**
 * Builds the HTML for shared flipbbook viewer, used by both the shortcode and the block.
 *
 * @param array $atts {
 *     @type int    $id    Attachment ID of the PDF. Falls back to the saved default.
 *     @type string $title Accessible title for the viewer region.
 *     @type string $width Optional max-width for the viewer (e.g. "1200px" or "100%").
 * }
 */
function arfb_render_flipbook( $atts = array() ) {
	$atts = shortcode_atts(
		array(
			'id'    => (int) get_option( 'arfb_default_attachment_id', 0 ),
			'title' => __( 'Annual report', 'annual-report-flipbook' ),
			'width' => '',
		),
		$atts,
		'annual_report_flipbook'
	);

	$attachment_id = absint( $atts['id'] );

	// Error for editor: No PDF chosen, or the chosen file isn't a PDF
	if ( ! $attachment_id || 'application/pdf' !== get_post_mime_type( $attachment_id ) ) {
		if ( current_user_can( 'edit_posts' ) ) {
			return '<p class="arfb-notice">' . esc_html__( 'Annual Report Flipbook: no PDF has been selected yet.', 'annual-report-flipbook' ) . '</p>';
		}
		return '';
	}

	arfb_enqueue_viewer_assets();

	$pdf_url = wp_get_attachment_url( $attachment_id );
	// Every viewer needs its own id, since one page can hold several flipbooks.
	// wp_unique_id() adds a counter so two copies of the same PDF still differ.
	$uid     = 'arfb-' . $attachment_id . '-' . wp_unique_id();
	$width   = arfb_sanitize_css_width( $atts['width'] );
	$style   = $width ? ' style="max-width:' . esc_attr( $width ) . ';"' : '';

	ob_start();
	?>
	<div class="arfb-flipbook-container">
		<div
			id="<?php echo esc_attr( $uid ); ?>"
			class="arfb-flipbook"
			data-pdf-url="<?php echo esc_url( $pdf_url ); ?>"
			data-title="<?php echo esc_attr( $atts['title'] ); ?>"
			<?php echo $style; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- value escaped above. ?>
		></div>
		<noscript>
			<p>
				<a href="<?php echo esc_url( $pdf_url ); ?>">
					<?php echo esc_html( sprintf( /* translators: %s: report title */ __( 'Download %s (PDF)', 'annual-report-flipbook' ), $atts['title'] ) ); ?>
				</a>
			</p>
			<p class="arfb-flipbook__note">Note: To view an accessible version of the report, download Ontario Superior Court of Justice: Progressing In The Public Interest 2024 – 2025 Report to view the PDF.</p>
		</noscript>
	</div>
	<?php
	return ob_get_clean();
}
add_shortcode( 'annual_report_flipbook', 'arfb_render_flipbook' );

/**
 * Register the Gutenberg block as a dynamic block backed by the same
 * render function as the shortcode, so both stay in sync automatically.
 */
function arfb_register_block() {
	wp_register_script(
		'arfb-block-editor',
		ARFB_PLUGIN_URL . 'assets/js/block-editor.js',
		array( 'wp-blocks', 'wp-element', 'wp-block-editor', 'wp-components', 'wp-i18n', 'wp-media-utils' ),
		ARFB_VERSION,
		true
	);

	register_block_type(
		'annual-report-flipbook/viewer',
		array(
			'editor_script'   => 'arfb-block-editor',
			'render_callback' => 'arfb_render_block',
			'attributes'      => array(
				'attachmentId' => array(
					'type'    => 'number',
					'default' => 0,
				),
				'title'        => array(
					'type'    => 'string',
					'default' => __( 'Annual report', 'annual-report-flipbook' ),
				),
				'size'         => array(
					'type'    => 'string',
					'default' => 'medium',
				),
				'customWidth'  => array(
					'type'    => 'string',
					'default' => '',
				),
			),
		)
	);
}
add_action( 'init', 'arfb_register_block' );

/**
 * Block render callback: maps block attributes onto the shared shortcode-style
 * renderer. If no attachment was picked yet, falls back to the saved default.
 */
function arfb_render_block( $attributes ) {
	$attachment_id = ! empty( $attributes['attachmentId'] )
		? (int) $attributes['attachmentId']
		: (int) get_option( 'arfb_default_attachment_id', 0 );

	$size   = isset( $attributes['size'] ) ? $attributes['size'] : 'medium';
	$custom = isset( $attributes['customWidth'] ) ? $attributes['customWidth'] : '';

	return arfb_render_flipbook(
		array(
			'id'    => $attachment_id,
			'title' => isset( $attributes['title'] ) ? $attributes['title'] : '',
			'width' => arfb_resolve_width( $size, $custom ),
		)
	);
}
