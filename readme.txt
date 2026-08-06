=== Annual Report Flipbook ===
Contributors: Alyssa Lu, Sim Yu Lau
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Drag-and-drop a PDF in the admin, then embed it anywhere as an accessible,
interactive page-flip viewer via a Gutenberg block or shortcode.

== Description ==

Annual Report Flipbook turns a PDF into an interactive, page-turning reading
experience directly in the browser.

**How it works**

1. Go to **Report Flipbook** in the WordPress admin menu.
2. Drag a PDF onto the drop zone (or click to browse). It uploads straight
   to your Media Library and previews immediately as a live flipbook.
3. Save it as the site's default report, and/or copy the generated
   shortcode -- or use the **Annual Report Flipbook** block in the block
   editor -- to place it on any page or post.

**Accessibility**

* Full keyboard navigation (arrow keys, Home/End)
* ARIA live region announcing page changes, including both pages of a spread
* Respects `prefers-reduced-motion` (disables the flip animation)
* PDF text layer kept in the DOM for screen readers and text selection
* Plain "Download PDF" link always available as a fallback

Note that the viewer shows one spread at a time, so a screen reader's
continuous-reading mode stops at the end of each spread rather than carrying
on through the document. For reading a long report straight through, the
Download PDF link is the better path, and it is always present.

== Installation ==

= For site owners =

1. Get `annual-report-flipbook.zip` -- from the project's GitHub Releases
   page, or from whoever maintains the site.
2. In wp-admin, go to **Plugins -> Add New -> Upload Plugin**, choose the
   zip, and click **Install Now**, then **Activate**.
3. Go to **Report Flipbook** in the admin menu and drop in your PDF.
4. Copy the generated shortcode onto a page, or add the **Annual Report
   Flipbook** block in the block editor.

= Requirements =

* WordPress 6.0 or later, PHP 7.4 or later.
* A site that allows custom plugins: self-hosted WordPress.org, or
  WordPress.com on a Business/Commerce plan. Lower WordPress.com plans do
  not permit plugin uploads.

Building the plugin from source is a separate process -- see the next
section.

== For developers ==

This section applies when working from the source repository rather than an
already-built zip.

= Getting started =

Clone the repository and you have everything you need -- PDF.js and
StPageFlip are already vendored into `assets/vendor/` and committed, so
there is no install step before the plugin will run.

`SETUP.md` documents where those two files came from and the exact versions
to use. Read it before upgrading either library: PDF.js must stay on a build
that exposes a real `window.pdfjsLib` global, and newer releases do not.

= Building the zip =

    npm run build:zip

This wraps `git archive`, so it packages the **last commit** rather than your
working tree -- commit first, or you will ship an older state. Output is
`annual-report-flipbook.zip` in the project root, with the dev and test
tooling stripped out via the `export-ignore` rules in `.gitattributes`.

For a tagged release, CI builds the zip from the tag and attaches it to the
GitHub Release; that artifact is the authoritative download. `BUILD.md` has
the full process.

= Running the tests =

    npm run test:e2e     Playwright: viewer behaviour, via preview.html.
                         No WordPress needed.
    npm run test:php     PHPUnit: render/shortcode/ajax logic, inside a real
                         WordPress. Requires Docker.

`TESTING.md` describes both layers and the manual pre-release checklist.

= A note on these docs =

`SETUP.md`, `BUILD.md` and `TESTING.md` are excluded from the distributed
zip, so they are only readable in the GitHub repository -- not inside an
installed copy of the plugin.

== Credits ==

Built on open source:

* **PDF.js** (Mozilla) renders each page in the browser, including a
  selectable text layer for screen readers and copy/paste.
* **StPageFlip** drives the realistic page-turn animation and touch
  gestures.

Both are vendored locally rather than loaded from a CDN, so the plugin makes
no third-party requests at runtime.

Portions of this plugin were developed with assistance from **Claude**
(Anthropic), including the accessibility announcements, the reproducible
`git archive` packaging, and the automated test suite.

== Changelog ==

= 1.0.0 =
* Initial release: admin drag-and-drop upload, Gutenberg block, shortcode,
  accessible PDF.js + StPageFlip viewer.
