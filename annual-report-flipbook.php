<?php
/**
 * Plugin Name:       Annual Report Flipbook
 * Plugin URI:        https://example.org/annual-report-flipbook
 * Description:       Drag-and-drop a PDF in the admin, then embed it anywhere as an accessible, interactive page-flip viewer via a Gutenberg block or shortcode. Built on PDF.js and StPageFlip.
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Your Organization
 * License:           GPL v2 or later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       annual-report-flipbook
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // No direct access.
}

define( 'ARFB_VERSION', '1.0.0' );
define( 'ARFB_PLUGIN_FILE', __FILE__ );
define( 'ARFB_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'ARFB_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

require_once ARFB_PLUGIN_DIR . 'includes/admin-page.php';
require_once ARFB_PLUGIN_DIR . 'includes/block.php';

/**
 * Plugin activation: create the option used to remember the
 * most recently uploaded report so the admin page has something
 * to show immediately after activation.
 */
function arfb_activate() {
	if ( false === get_option( 'arfb_default_attachment_id' ) ) {
		add_option( 'arfb_default_attachment_id', 0 );
	}
}
register_activation_hook( ARFB_PLUGIN_FILE, 'arfb_activate' );

/**
 * Load translations.
 */
function arfb_load_textdomain() {
	load_plugin_textdomain( 'annual-report-flipbook', false, dirname( plugin_basename( ARFB_PLUGIN_FILE ) ) . '/languages' );
}
add_action( 'plugins_loaded', 'arfb_load_textdomain' );
