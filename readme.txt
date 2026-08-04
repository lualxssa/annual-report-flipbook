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

**Built on open source**

* PDF.js (Mozilla) renders each page in the browser, including a selectable
  text layer for screen readers and copy/paste.
* StPageFlip drives the realistic page-turn animation and touch gestures.

Both libraries are vendored locally (see `SETUP.md` in the plugin folder)
rather than loaded from a CDN.

**Accessibility**

* Full keyboard navigation (arrow keys, Home/End)
* ARIA live region announcing page changes
* Respects `prefers-reduced-motion` (disables the flip animation)
* PDF text layer kept in the DOM for screen readers and text selection
* Plain "Download PDF" link always available as a fallback

**Requirements**

Installing a custom plugin requires either a self-hosted WordPress.org site,
or a WordPress.com Business/Commerce plan. See `SETUP.md` for the one-time
step of pulling in the PDF.js and StPageFlip library files.

== Installation ==

1. Follow `SETUP.md` to vendor the PDF.js and StPageFlip library files into
   `assets/vendor/`.
2. Build the plugin zip:

       npm run build:zip

   This wraps `git archive`, so it packages the **last commit** rather than
   your working tree -- commit first. Output is `annual-report-flipbook.zip`
   in the project root, with the dev and test tooling stripped out. For a
   tagged release, CI builds the zip from the tag and attaches it to the
   GitHub Release; see `BUILD.md` for the full details.
3. In wp-admin, go to Plugins -> Add New -> Upload Plugin, choose the zip,
   and activate.
4. Go to Report Flipbook in the admin menu and drop in your PDF.

== Changelog ==

= 1.0.0 =
* Initial release: admin drag-and-drop upload, Gutenberg block, shortcode,
  accessible PDF.js + StPageFlip viewer.
