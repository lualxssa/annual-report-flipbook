<?php
/**
 * Tests for the shared render path in includes/block.php: arfb_render_flipbook()
 * (shortcode + block) and arfb_render_block(). Asserts the key facts a user
 * relies on — the PDF URL is wired in, a download fallback exists, the size is
 * applied, and the "no PDF" notice behaves — not exact markup.
 *
 * @package Annual_Report_Flipbook
 */

class Test_Arfb_Render extends WP_UnitTestCase {

	/** @var int A valid PDF attachment. */
	protected $pdf_id;

	public function set_up() {
		parent::set_up();
		// An attachment with a PDF mime type and an attached file, so
		// wp_get_attachment_url() returns a real URL.
		$this->pdf_id = self::factory()->attachment->create_object(
			'annual-report.pdf',
			0,
			array(
				'post_mime_type' => 'application/pdf',
				'post_type'      => 'attachment',
			)
		);
	}

	public function test_valid_pdf_renders_viewer_with_url_and_fallback() {
		$html    = arfb_render_flipbook( array( 'id' => $this->pdf_id ) );
		$pdf_url = wp_get_attachment_url( $this->pdf_id );

		$this->assertStringContainsString( 'arfb-flipbook', $html );
		$this->assertStringContainsString( 'data-pdf-url', $html );
		$this->assertStringContainsString( $pdf_url, $html );
		// The <noscript> download fallback links to the PDF.
		$this->assertStringContainsString( '<noscript>', $html );
	}

	public function test_width_is_applied_as_max_width() {
		$html = arfb_render_flipbook(
			array(
				'id'    => $this->pdf_id,
				'width' => '1200px',
			)
		);
		$this->assertStringContainsString( 'max-width:1200px', $html );
	}

	public function test_invalid_id_shows_notice_to_editors_only() {
		// Editor sees a helpful notice.
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$editor_html = arfb_render_flipbook( array( 'id' => 0 ) );
		$this->assertStringContainsString( 'no PDF has been selected', $editor_html );

		// A visitor without edit_posts sees nothing (no broken UI).
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
		$visitor_html = arfb_render_flipbook( array( 'id' => 0 ) );
		$this->assertSame( '', $visitor_html );
	}

	public function test_block_falls_back_to_saved_default() {
		update_option( 'arfb_default_attachment_id', $this->pdf_id );

		// No attachmentId given → uses the saved default.
		$html = arfb_render_block( array() );
		$this->assertStringContainsString( wp_get_attachment_url( $this->pdf_id ), $html );
	}

	public function test_block_maps_size_preset_to_width() {
		$html = arfb_render_block(
			array(
				'attachmentId' => $this->pdf_id,
				'size'         => 'large',
			)
		);
		$this->assertStringContainsString( 'max-width:1200px', $html );
	}
}
