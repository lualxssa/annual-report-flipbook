<?php
/**
 * PHPUnit bootstrap — loads the WordPress test framework and this plugin.
 * Runs inside `wp-env`'s tests environment (see TESTING.md). Dev-only.
 *
 * @package Annual_Report_Flipbook
 */

// Composer autoload (PHPUnit polyfills, wp-phpunit).
$arfb_autoload = dirname( __DIR__, 2 ) . '/vendor/autoload.php';
if ( file_exists( $arfb_autoload ) ) {
	require_once $arfb_autoload;
}

// Locate the WordPress test suite. wp-phpunit exposes WP_PHPUNIT__DIR; wp-env
// / a manual install may set WP_TESTS_DIR instead.
$_tests_dir = getenv( 'WP_TESTS_DIR' );
if ( ! $_tests_dir && getenv( 'WP_PHPUNIT__DIR' ) ) {
	$_tests_dir = getenv( 'WP_PHPUNIT__DIR' );
}
if ( ! $_tests_dir && file_exists( '/wordpress-phpunit/includes/functions.php' ) ) {
	$_tests_dir = '/wordpress-phpunit';
}

if ( ! $_tests_dir || ! file_exists( $_tests_dir . '/includes/functions.php' ) ) {
	echo "Could not find the WordPress test suite. Run tests via `npm run test:php` (wp-env).\n";
	exit( 1 );
}

require_once $_tests_dir . '/includes/functions.php';

/**
 * Load the plugin under test before WordPress finishes booting.
 */
function arfb_manually_load_plugin() {
	require dirname( __DIR__, 2 ) . '/annual-report-flipbook.php';
}
tests_add_filter( 'muplugins_loaded', 'arfb_manually_load_plugin' );

require $_tests_dir . '/includes/bootstrap.php';
