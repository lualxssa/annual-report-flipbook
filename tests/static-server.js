/**
 * Tiny static file server for the Playwright tests — serves the plugin folder
 * so preview.html / admin-preview.html and the vendored assets load over http://
 * (PDF.js's worker is unreliable over file://). Dev-only; not part of the plugin.
 *
 * Usage: node tests/static-server.js [port]   (default port 8080)
 */
'use strict';

var http = require( 'http' );
var fs = require( 'fs' );
var path = require( 'path' );

var ROOT = path.resolve( __dirname, '..' );
var PORT = parseInt( process.argv[ 2 ], 10 ) || 8080;

var TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.pdf': 'application/pdf',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.wasm': 'application/wasm',
};

var server = http.createServer( function ( req, res ) {
	// Strip query string and normalize; block path traversal outside ROOT.
	var urlPath = decodeURIComponent( req.url.split( '?' )[ 0 ] );
	if ( urlPath === '/' ) {
		urlPath = '/preview.html';
	}
	var filePath = path.normalize( path.join( ROOT, urlPath ) );
	if ( ! filePath.startsWith( ROOT ) ) {
		res.writeHead( 403 );
		res.end( 'Forbidden' );
		return;
	}

	fs.readFile( filePath, function ( err, data ) {
		if ( err ) {
			res.writeHead( 404, { 'Content-Type': 'text/plain' } );
			res.end( 'Not found: ' + urlPath );
			return;
		}
		var type = TYPES[ path.extname( filePath ).toLowerCase() ] || 'application/octet-stream';
		res.writeHead( 200, { 'Content-Type': type } );
		res.end( data );
	} );
} );

server.listen( PORT, function () {
	// eslint-disable-next-line no-console
	console.log( 'Static server for tests running at http://localhost:' + PORT );
} );
