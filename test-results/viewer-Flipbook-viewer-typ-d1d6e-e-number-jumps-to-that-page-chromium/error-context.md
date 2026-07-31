# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: viewer.spec.js >> Flipbook viewer >> typing a page number jumps to that page
- Location: tests\e2e\viewer.spec.js:34:2

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText(/Page 3 of \d+/)
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByText(/Page 3 of \d+/)

```

```yaml
- heading "Annual Report Flipbook" [level=1]
- paragraph: "Loading: tests/fixtures/sample.pdf (pass ?pdf=yourfile.pdf to preview a different one)"
- region "Annual report preview":
  - text: "Page 4 of 10 Fernández 4 and duty. Higher tiers correspond with an increase in shape angles (circle/worker, triangle/soldier, square/manager). It is no accident that the Front Man’s mask has the most angles, reminiscent of Cubism, to underline his leadership. Merchants and professional white collar workers align with the masked guards in that perhaps they are also destitute, indebted, and formerly middle class. Just like the players, the guards are hostages. Their “consent” to participate is a product of systemic violence that strips everyone but the wealthiest of personal sovereignty. In episode 3, “The Man with the Umbrella,” a player who is about to be executed takes a guard’s firearm and unmasks him, revealing a young man barely out of high school. Overwhelmed, the contestant shoots himself. The youth is executed in cold blood for revealing his identity. The game’s bourgeoise sponsors, whose golden masks each depict a different power animal (lion, bull, panther, eagle), arrive on the island to wager in person during episode 7, “VIPs.” The billionaires watch the spectacle from a private suite, where we witness a bacchanal of disregard for human life ripe with toxic masculinity. The evocation of totem animals, on the one hand, recalls heraldry. On the other hand, adopting a powerful symbol makes corporations distinctive, memorable and profitable. Emblems are essential to social stratification. Whether oligarchs or multinational corporations, emblematized social sectors that own the means of production also control the media professions. 4 We, the teals and the magentas, are toys for the powerful, implies the show’s writer. “I wanted to create something that would resonate not just for Korean people but globally,\" says Hwang Dong-hyuk, in an article for The Guardian . \"I do believe that the overall global economic order is unequal and that around 90% of the people believe that it's unfair. During the pandemic, poorer countries can't get their people vaccinated. 4 See Table 2.2 “The Big Six US-based media conglomerates (2018),” about the media industry’s vertical integration, in Critical Media Studies, 33-4. Fernández 5 They're contracting viruses on the streets and even dying. So I did try to convey a message about modern capitalism. As I said, it's not profound” (Stuart). III. Ethics, Privacy and Technological Concerns in Squid Game A. Despair The asymmetrical economic world order Hwang Dong-hyuk references thrives in the public availability of personal and financial information. Data-gathering enables the Squid Game algorithm to target potential contestants based on their degree of despair. In “Privacy and Participation in the Cloud: Implications in Google Privacy Practices and Public Communications,” Robert Bodle details the threats to privacy inherent in cloud computing, or Web 2.0. This “new” 2010s-2020s Web 2.0 differs from the 1990s-2000s Web 1.0 in that user-generated content sites, social networks, and microblogs 5 increasingly depend on sharing personal information while downplaying privacy protection (157). The algorithmic selection that informs Squid Game is a reflection of a contestant’s online presence built from consensual sharing of personal information. The aggregated data operates in the same fashion as targeted advertisement, which, were it not for public pressure, would be completely devoid of ethical boundaries. Irina Raicu argues that “even users in a single region of the world (or a single room) are already likely to be shown very different search results--unless they've actively taken steps to turn off the \"personalized search\" that Google implements as its default setting.” Most people do not know that one may turn off Google’s personalized search, let alone how to disengage it. In the pivotal scene where Seong Gi-hun recalls the Ssangyong Motors strike, we learn that in 2009 the company 5 Since the publication of Ethics of Emerging Media in 2011, the distinction between user-generated content sites (YouTube), social networks (Facebook) and microblogs (Twitter) is now obsolete. YouTube, Facebook, Twitter, Instagram, Pinterest, LinkedIn, SnapChat, Google Spaces, Canva, TikTok, etc. are all user-generated social network microblogs. Perhaps it is time to upgrade the phenomenon to Web 3.0, or the hyper vertical integration of the internet."
  - button "Previous page"
  - button "Next page"
  - button "Zoom out"
  - button "Zoom in"
  - spinbutton "Go to page": "4"
  - text: / 10
  - button "Toggle fullscreen"
  - link "Download PDF":
    - /url: tests/fixtures/sample.pdf
```

# Test source

```ts
  1  | // Behaviour smoke tests for the flipbook viewer, driven through the standalone
  2  | // preview page (no WordPress). These assert what a reader would notice — the
  3  | // PDF loads, the controls work and are labelled, errors fall back gracefully —
  4  | // not styling/implementation details.
  5  | const { test, expect } = require( '@playwright/test' );
  6  | 
  7  | const GOOD_PDF = '/preview.html?pdf=tests/fixtures/sample.pdf';
  8  | const PAGE_INDICATOR = /Page \d+ of \d+/;
  9  | 
  10 | test.describe( 'Flipbook viewer', () => {
  11 | 	test( 'loads a PDF and shows page content', async ( { page } ) => {
  12 | 		await page.goto( GOOD_PDF );
  13 | 
  14 | 		// The page indicator only appears once the viewer has loaded and built
  15 | 		// its UI, so seeing it is proof the PDF opened.
  16 | 		await expect( page.getByText( PAGE_INDICATOR ) ).toBeVisible();
  17 | 		await expect( page.getByText( /could not be loaded/i ) ).toHaveCount( 0 );
  18 | 	} );
  19 | 
  20 | 	test( 'Next advances the page and Previous goes back', async ( { page } ) => {
  21 | 		await page.goto( GOOD_PDF );
  22 | 
  23 | 		const indicator = page.getByText( PAGE_INDICATOR );
  24 | 		await expect( indicator ).toBeVisible();
  25 | 		const first = await indicator.textContent();
  26 | 
  27 | 		await page.getByRole( 'button', { name: 'Next page' } ).click();
  28 | 		await expect( indicator ).not.toHaveText( first );
  29 | 
  30 | 		await page.getByRole( 'button', { name: 'Previous page' } ).click();
  31 | 		await expect( indicator ).toHaveText( first );
  32 | 	} );
  33 | 
  34 | 	test( 'typing a page number jumps to that page', async ( { page } ) => {
  35 | 		await page.goto( GOOD_PDF );
  36 | 
  37 | 		const indicator = page.getByText( PAGE_INDICATOR );
  38 | 		await expect( indicator ).toBeVisible();
  39 | 		const first = await indicator.textContent();
  40 | 
  41 | 		const pageInput = page.locator( '.arfb-flipbook__page-input' ).first();
  42 | 		await pageInput.fill( '3' );
  43 | 		await pageInput.press( 'Enter' );
  44 | 
  45 | 		await expect( indicator ).not.toHaveText( first );
> 46 | 		await expect( page.getByText( /Page 3 of \d+/ ) ).toBeVisible();
     |                                                     ^ Error: expect(locator).toBeVisible() failed
  47 | 	} );
  48 | 
  49 | 	test( 'exposes the main controls with accessible names', async ( { page } ) => {
  50 | 		await page.goto( GOOD_PDF );
  51 | 		await expect( page.getByText( PAGE_INDICATOR ) ).toBeVisible();
  52 | 
  53 | 		await expect( page.getByRole( 'button', { name: 'Previous page' } ) ).toBeVisible();
  54 | 		await expect( page.getByRole( 'button', { name: 'Next page' } ) ).toBeVisible();
  55 | 		await expect( page.getByRole( 'button', { name: 'Toggle fullscreen' } ) ).toBeVisible();
  56 | 		await expect( page.getByRole( 'link', { name: 'Download PDF' } ) ).toBeVisible();
  57 | 	} );
  58 | 
  59 | 	test( 'the download link points at the PDF', async ( { page } ) => {
  60 | 		await page.goto( GOOD_PDF );
  61 | 		const download = page.getByRole( 'link', { name: 'Download PDF' } );
  62 | 		await expect( download ).toHaveAttribute( 'href', /sample\.pdf/ );
  63 | 	} );
  64 | 
  65 | 	test( 'a missing PDF shows an error with a download fallback', async ( { page } ) => {
  66 | 		await page.goto( '/preview.html?pdf=/does-not-exist.pdf' );
  67 | 
  68 | 		await expect( page.getByText( /could not be loaded/i ) ).toBeVisible();
  69 | 		await expect( page.getByRole( 'link', { name: /Download PDF/i } ) ).toBeVisible();
  70 | 	} );
  71 | } );
  72 | 
```