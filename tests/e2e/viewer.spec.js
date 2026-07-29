// Behaviour smoke tests for the flipbook viewer, driven through the standalone
// preview page (no WordPress). These assert what a reader would notice — the
// PDF loads, the controls work and are labelled, errors fall back gracefully —
// not styling/implementation details.
const { test, expect } = require( '@playwright/test' );

const GOOD_PDF = '/preview.html?pdf=tests/fixtures/sample.pdf';
const PAGE_INDICATOR = /Page \d+ of \d+/;

test.describe( 'Flipbook viewer', () => {
	test( 'loads a PDF and shows page content', async ( { page } ) => {
		await page.goto( GOOD_PDF );

		// The page indicator only appears once the viewer has loaded and built
		// its UI, so seeing it is proof the PDF opened.
		await expect( page.getByText( PAGE_INDICATOR ) ).toBeVisible();
		await expect( page.getByText( /could not be loaded/i ) ).toHaveCount( 0 );
	} );

	test( 'Next advances the page and Previous goes back', async ( { page } ) => {
		await page.goto( GOOD_PDF );

		const indicator = page.getByText( PAGE_INDICATOR );
		await expect( indicator ).toBeVisible();
		const first = await indicator.textContent();

		await page.getByRole( 'button', { name: 'Next page' } ).click();
		await expect( indicator ).not.toHaveText( first );

		await page.getByRole( 'button', { name: 'Previous page' } ).click();
		await expect( indicator ).toHaveText( first );
	} );

	test( 'exposes the main controls with accessible names', async ( { page } ) => {
		await page.goto( GOOD_PDF );
		await expect( page.getByText( PAGE_INDICATOR ) ).toBeVisible();

		await expect( page.getByRole( 'button', { name: 'Previous page' } ) ).toBeVisible();
		await expect( page.getByRole( 'button', { name: 'Next page' } ) ).toBeVisible();
		await expect( page.getByRole( 'button', { name: 'Toggle fullscreen' } ) ).toBeVisible();
		await expect( page.getByRole( 'link', { name: 'Download PDF' } ) ).toBeVisible();
	} );

	test( 'the download link points at the PDF', async ( { page } ) => {
		await page.goto( GOOD_PDF );
		const download = page.getByRole( 'link', { name: 'Download PDF' } );
		await expect( download ).toHaveAttribute( 'href', /sample\.pdf/ );
	} );

	test( 'a missing PDF shows an error with a download fallback', async ( { page } ) => {
		await page.goto( '/preview.html?pdf=/does-not-exist.pdf' );

		await expect( page.getByText( /could not be loaded/i ) ).toBeVisible();
		await expect( page.getByRole( 'link', { name: /Download PDF/i } ) ).toBeVisible();
	} );
} );
