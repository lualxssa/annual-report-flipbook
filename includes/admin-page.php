<?php
/**
 * Admin screen: drag-and-drop a PDF, see it instantly rendered as a flipbook,
 * and save it as the default report (or copy the shortcode to place elsewhere).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Add "Report Flipbook" to the WordPress admin menu.
 *
 * The 'upload_files' argument is the permission needed to see it. That's the
 * same permission WordPress uses for adding media, which fits: this screen only
 * uploads a PDF and remembers which one to show. Requiring full administrator
 * rights would stop editors doing their own job.
 */
function arfb_register_admin_menu() {
	add_menu_page(
		__( 'Annual Report Flipbook', 'annual-report-flipbook' ),
		__( 'Report Flipbook', 'annual-report-flipbook' ),
		'upload_files',
		'arfb-flipbook',
		'arfb_render_admin_page',
		'dashicons-book-alt',
		25
	);
}
add_action( 'admin_menu', 'arfb_register_admin_menu' );

/**
 * Render the admin page markup. All behavior is handled by admin-uploader.js.
 */
function arfb_render_admin_page() {
	// Checked again even though the menu already requires this permission.
	// Hiding a menu item only hides it — someone can still type the URL — so the
	// page itself has to check as well.
	if ( ! current_user_can( 'upload_files' ) ) {
		wp_die( esc_html__( 'You do not have permission to upload files.', 'annual-report-flipbook' ) );
	}

	$attachment_id = (int) get_option( 'arfb_default_attachment_id', 0 );
	$pdf_url       = $attachment_id ? wp_get_attachment_url( $attachment_id ) : '';
	?>
	<div class="wrap arfb-admin-wrap">
		<h1><?php esc_html_e( 'Annual Report Flipbook', 'annual-report-flipbook' ); ?></h1>
		<p><?php esc_html_e( 'Drop a PDF below to upload it to the Media Library and preview it as a flipbook. Once you\'re happy with it, save it as the default report or copy the shortcode to place it on a specific page.', 'annual-report-flipbook' ); ?></p>

		<div id="arfb-dropzone" class="arfb-dropzone" tabindex="0" role="button"
			aria-label="<?php esc_attr_e( 'Drag and drop a PDF file here, or press Enter to browse for a file', 'annual-report-flipbook' ); ?>">
			<p class="arfb-dropzone__text">
				<?php esc_html_e( 'Drag & drop a PDF here, or click to browse', 'annual-report-flipbook' ); ?>
			</p>
			<input type="file" id="arfb-file-input" accept="application/pdf" class="arfb-visually-hidden" />
		</div>

		<div id="arfb-upload-status" class="arfb-upload-status" role="status" aria-live="polite"></div>

		<div id="arfb-preview-wrap" style="<?php echo $attachment_id ? '' : 'display:none;'; ?>">
			<h2><?php esc_html_e( 'Preview', 'annual-report-flipbook' ); ?></h2>
			<div id="arfb-preview" class="arfb-flipbook" data-pdf-url="<?php echo esc_url( $pdf_url ); ?>" data-title="<?php esc_attr_e( 'Report preview', 'annual-report-flipbook' ); ?>"></div>

			<p>
				<button type="button" id="arfb-save-default" class="button button-primary">
					<?php esc_html_e( 'Save as the default report', 'annual-report-flipbook' ); ?>
				</button>
			</p>

			<h3><?php esc_html_e( 'Embed on any page or post', 'annual-report-flipbook' ); ?></h3>
			<p><?php esc_html_e( 'Use the "Annual Report Flipbook" block, or paste this shortcode:', 'annual-report-flipbook' ); ?></p>
			<code id="arfb-shortcode">[annual_report_flipbook id="<?php echo esc_attr( $attachment_id ); ?>"]</code>
		</div>
	</div>
	<?php
}

/**
 * Enqueue admin assets only on this plugin's settings page.
 */
function arfb_admin_enqueue_assets( $hook ) {
	if ( 'toplevel_page_arfb-flipbook' !== $hook ) {
		return;
	}

	arfb_enqueue_viewer_assets();

	wp_enqueue_script(
		'arfb-admin-uploader',
		ARFB_PLUGIN_URL . 'assets/js/admin-uploader.js',
		array( 'wp-i18n' ),
		ARFB_VERSION,
		true
	);

	wp_enqueue_style(
		'arfb-admin-style',
		ARFB_PLUGIN_URL . 'assets/css/flipbook.css',
		array(),
		ARFB_VERSION
	);

	// Addresses and security tokens the uploader script needs.
	//
	// There are two of each because the screen does two different jobs through
	// two different WordPress systems. Uploading the file goes to the built-in
	// media endpoint (restUrl); remembering which PDF is the default goes to our
	// own handler further down this file (ajaxUrl). Each needs its own token.
	//
	// A "nonce" is a short-lived token proving the request came from a form we
	// generated, rather than from another site making your browser click things
	// behind your back. It proves origin, not permission — the handler still has
	// to check the user is allowed to do this.
	wp_localize_script(
		'arfb-admin-uploader',
		'arfbAdmin',
		array(
			'restUrl'      => esc_url_raw( rest_url( 'wp/v2/media' ) ),
			'restNonce'    => wp_create_nonce( 'wp_rest' ),
			'ajaxUrl'      => admin_url( 'admin-ajax.php' ),
			'saveNonce'    => wp_create_nonce( 'arfb_save_attachment' ),
			'i18n'         => array(
				'uploading'   => __( 'Uploading…', 'annual-report-flipbook' ),
				'uploadError' => __( 'Upload failed. Please make sure the file is a PDF and try again.', 'annual-report-flipbook' ),
				'saved'       => __( 'Saved as the default report.', 'annual-report-flipbook' ),
				'notAPdf'     => __( 'Please drop a PDF file.', 'annual-report-flipbook' ),
			),
		)
	);
}
add_action( 'admin_enqueue_scripts', 'arfb_admin_enqueue_assets' );

/**
 * Handles the "Save as the default report" button.
 *
 * Saves which PDF the site should show when a shortcode or block doesn't name
 * one itself. Called by admin-uploader.js in the background, so it replies with
 * JSON rather than a page.
 *
 * Anything reachable over the network has to assume the caller is hostile, so
 * this checks three separate things before saving, in order:
 *
 *   1. the token — did this come from our screen?
 *   2. the permission — is this user allowed to?
 *   3. the value itself — is it really a PDF in the media library?
 *
 * All three matter. The first two can both pass and the request still be
 * nonsense, because the id arrives from the browser and anyone can change it
 * before it's sent. Without check 3 someone could point the site's report at
 * any file at all.
 */
function arfb_ajax_save_attachment() {
	// 1. Stops another site making your browser send this request while you're
	// logged in. Ends the request straight away if the token is wrong.
	check_ajax_referer( 'arfb_save_attachment', 'nonce' );

	// 2. A valid token only proves where the request came from, not that this
	// person is allowed to change the site's report. Check that separately.
	if ( ! current_user_can( 'upload_files' ) ) {
		wp_send_json_error( array( 'message' => __( 'Permission denied.', 'annual-report-flipbook' ) ), 403 );
	}

	// absint() forces this to a whole positive number, so nothing odd reaches
	// the database lookup below.
	$attachment_id = isset( $_POST['attachment_id'] ) ? absint( $_POST['attachment_id'] ) : 0;

	// 3. Confirm it's a real media item and really a PDF, rather than trusting
	// what the browser sent.
	if ( ! $attachment_id || 'application/pdf' !== get_post_mime_type( $attachment_id ) ) {
		wp_send_json_error( array( 'message' => __( 'Invalid attachment.', 'annual-report-flipbook' ) ), 400 );
	}

	update_option( 'arfb_default_attachment_id', $attachment_id );

	wp_send_json_success( array( 'attachment_id' => $attachment_id ) );
}
add_action( 'wp_ajax_arfb_save_attachment', 'arfb_ajax_save_attachment' );
