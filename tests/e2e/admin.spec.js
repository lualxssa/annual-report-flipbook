// Behaviour smoke test for the admin drag-and-drop screen, via the standalone
// admin preview (no WordPress). Checks that choosing a PDF produces a preview
// and an embed snippet — the core admin flow — without asserting styling.
const { test, expect } = require( '@playwright/test' );
const path = require( 'path' );

const FIXTURE = path.resolve( __dirname, '..', 'fixtures', 'sample.pdf' );

test.describe( 'Admin uploader screen', () => {
	test( 'shows the dropzone and previews a chosen PDF', async ( { page } ) => {
		await page.goto( '/admin-preview.html' );

		// The dropzone is exposed as a button for keyboard/AT users.
		await expect( page.getByRole( 'button', { name: /drag and drop a pdf/i } ) ).toBeVisible();

		// Choosing a file should reveal the preview and generate the shortcode.
		await page.locator( '#arfb-file-input' ).setInputFiles( FIXTURE );

		await expect( page.getByText( /Page \d+ of \d+/ ) ).toBeVisible();
		await expect( page.getByText( /\[annual_report_flipbook/ ) ).toBeVisible();
	} );
} );
