// Playwright config for the viewer/UI end-to-end tests. Dev-only.
// Starts the tiny static server (tests/static-server.js) and runs the specs in
// tests/e2e against it. See TESTING.md.
const { defineConfig, devices } = require( '@playwright/test' );

const PORT = 8080;
const BASE_URL = 'http://localhost:' + PORT;

module.exports = defineConfig( {
	testDir: './tests/e2e',
	timeout: 30000,
	expect: { timeout: 10000 }, // PDF.js needs a moment to render the first page
	fullyParallel: true,
	reporter: 'list',
	use: {
		baseURL: BASE_URL,
		trace: 'on-first-retry',
	},
	projects: [
		{ name: 'chromium', use: { ...devices[ 'Desktop Chrome' ] } },
	],
	webServer: {
		command: 'node tests/static-server.js ' + PORT,
		url: BASE_URL,
		reuseExistingServer: ! process.env.CI,
		timeout: 20000,
	},
} );
