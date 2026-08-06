// Behaviour smoke tests for the flipbook viewer, driven through the standalone
// preview page (no WordPress). These assert what a reader would notice — the
// PDF loads, the controls work and are labelled, errors fall back gracefully —
// not styling/implementation details.
const { test, expect } = require( '@playwright/test' );

const GOOD_PDF = '/preview.html?pdf=tests/fixtures/sample.pdf';
// The viewer announces a lone cover as "Page 1 of 10" but an interior spread as
// "Pages 2–3 of 10", so match both shapes.
const PAGE_INDICATOR = /Pages? \d+(–\d+)? of \d+/;

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

	test( 'typing a page number jumps to that page', async ( { page } ) => {
		await page.goto( GOOD_PDF );

		const indicator = page.getByText( PAGE_INDICATOR );
		await expect( indicator ).toBeVisible();
		const first = await indicator.textContent();

		const pageInput = page.locator( '.arfb-flipbook__page-input' ).first();
		await pageInput.fill( '3' );
		await pageInput.press( 'Enter' );

		await expect( indicator ).not.toHaveText( first );
		await expect( pageInput ).toHaveValue( '3' );
		// Page 3 sits on the 2-3 spread in landscape, or alone in portrait.
		await expect( page.getByText( /(Pages 2–3|Page 3) of \d+/ ) ).toBeVisible();
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
