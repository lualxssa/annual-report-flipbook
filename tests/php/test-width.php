<?php
/**
 * Unit tests for the width helpers in includes/block.php — pure logic that
 * powers the block's "Viewer size" control and the shortcode `width` attribute.
 *
 * @package Annual_Report_Flipbook
 */

class Test_Arfb_Width extends WP_UnitTestCase {

	public function test_sanitize_accepts_bare_number_as_pixels() {
		$this->assertSame( '600px', arfb_sanitize_css_width( '600' ) );
		$this->assertSame( '600px', arfb_sanitize_css_width( 600 ) );
	}

	public function test_sanitize_accepts_valid_units() {
		$this->assertSame( '1200px', arfb_sanitize_css_width( '1200px' ) );
		$this->assertSame( '100%', arfb_sanitize_css_width( '100%' ) );
		$this->assertSame( '90vw', arfb_sanitize_css_width( '90vw' ) );
		$this->assertSame( '2rem', arfb_sanitize_css_width( '2rem' ) );
	}

	public function test_sanitize_rejects_empty_and_garbage() {
		$this->assertSame( '', arfb_sanitize_css_width( '' ) );
		$this->assertSame( '', arfb_sanitize_css_width( 'abc' ) );
		$this->assertSame( '', arfb_sanitize_css_width( '100px; color:red' ) );
		$this->assertSame( '', arfb_sanitize_css_width( 'javascript:alert(1)' ) );
	}

	public function test_resolve_presets_map_to_expected_widths() {
		$this->assertSame( '600px', arfb_resolve_width( 'small' ) );
		$this->assertSame( '900px', arfb_resolve_width( 'medium' ) );
		$this->assertSame( '1200px', arfb_resolve_width( 'large' ) );
		$this->assertSame( '100%', arfb_resolve_width( 'full' ) );
	}

	public function test_resolve_custom_uses_sanitized_value() {
		$this->assertSame( '800px', arfb_resolve_width( 'custom', '800px' ) );
		$this->assertSame( '800px', arfb_resolve_width( 'custom', '800' ) );
		$this->assertSame( '', arfb_resolve_width( 'custom', 'nonsense' ) );
	}

	public function test_resolve_unknown_size_falls_back_to_stylesheet_default() {
		$this->assertSame( '', arfb_resolve_width( 'bogus' ) );
		$this->assertSame( '', arfb_resolve_width( '' ) );
	}
}
