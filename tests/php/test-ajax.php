<?php
/**
 * Tests for the admin-ajax "save default report" handler
 * (arfb_ajax_save_attachment in includes/admin-page.php). Focuses on the
 * security/validation logic by asserting side effects (was the option saved?),
 * which is robust regardless of how wp_die is thrown in the test harness.
 *
 * @package Annual_Report_Flipbook
 * @group ajax
 */

class Test_Arfb_Ajax extends WP_Ajax_UnitTestCase {

	protected $pdf_id;
	protected $text_id;

	public function set_up() {
		parent::set_up();
		$this->pdf_id  = self::factory()->attachment->create_object(
			'report.pdf',
			0,
			array( 'post_mime_type' => 'application/pdf', 'post_type' => 'attachment' )
		);
		$this->text_id = self::factory()->attachment->create_object(
			'notes.txt',
			0,
			array( 'post_mime_type' => 'text/plain', 'post_type' => 'attachment' )
		);
		update_option( 'arfb_default_attachment_id', 0 );
	}

	private function dispatch() {
		try {
			$this->_handleAjax( 'arfb_save_attachment' );
		} catch ( Exception $e ) {
			// wp_send_json_* / wp_die throw in the ajax harness; the response
			// and side effects are what we assert on.
		}
	}

	public function test_bad_nonce_does_not_save() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$_POST['nonce']         = 'not-a-real-nonce';
		$_POST['attachment_id'] = $this->pdf_id;

		$this->dispatch();

		$this->assertSame( 0, (int) get_option( 'arfb_default_attachment_id' ) );
	}

	public function test_user_without_upload_files_is_rejected() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
		$_POST['nonce']         = wp_create_nonce( 'arfb_save_attachment' );
		$_POST['attachment_id'] = $this->pdf_id;

		$this->dispatch();

		$response = json_decode( $this->_last_response, true );
		$this->assertIsArray( $response );
		$this->assertFalse( $response['success'] );
		$this->assertSame( 0, (int) get_option( 'arfb_default_attachment_id' ) );
	}

	public function test_non_pdf_is_rejected() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$_POST['nonce']         = wp_create_nonce( 'arfb_save_attachment' );
		$_POST['attachment_id'] = $this->text_id;

		$this->dispatch();

		$response = json_decode( $this->_last_response, true );
		$this->assertIsArray( $response );
		$this->assertFalse( $response['success'] );
		$this->assertSame( 0, (int) get_option( 'arfb_default_attachment_id' ) );
	}

	public function test_valid_pdf_is_saved() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$_POST['nonce']         = wp_create_nonce( 'arfb_save_attachment' );
		$_POST['attachment_id'] = $this->pdf_id;

		$this->dispatch();

		$response = json_decode( $this->_last_response, true );
		$this->assertIsArray( $response );
		$this->assertTrue( $response['success'] );
		$this->assertSame( $this->pdf_id, (int) get_option( 'arfb_default_attachment_id' ) );
	}
}
