# Setup: vendoring PDF.js and StPageFlip

This plugin loads two open-source JS libraries from its own `assets/vendor/`
folder rather than a CDN (more reliable, works offline, no third-party
tracking/availability risk on your site). They are **not included in this
repo** — pull them in once via npm, using the exact steps below, then commit
the resulting files to your plugin.

Do this from a machine with Node.js installed (this is a one-time build
step; the WordPress site itself needs no Node.js).

## 1. PDF.js (Mozilla, Apache-2.0)

**Do not use `@latest`.** Starting with pdfjs-dist v4, the package dropped its
UMD build entirely — even the `legacy/` folder is ESM-only (`export {...}`)
from v4 onward. `flipbook.js` loads this file via a plain `<script src="...">`
tag and expects a real global `window.pdfjsLib`; an ESM file loaded that way
throws a syntax error on the `export` statement and silently fails (shows as
"the report could not be loaded" with no obvious error unless you check the
browser console). **v3.11.174 is the last release with a true UMD
`legacy/build/pdf.min.js`** — pin to that:

```
mkdir pdfjs-tmp && cd pdfjs-tmp
npm init -y
npm install pdfjs-dist@3.11.174
```

Copy the **legacy UMD build** (`.js`, not `.mjs` — confirm the file you copy
starts with `!function webpackUniversalModuleDefinition` and ends with a
webpack IIFE, not an `export{...}` statement):

```
cp node_modules/pdfjs-dist/legacy/build/pdf.min.js        ../assets/vendor/pdfjs/pdf.min.js
cp node_modules/pdfjs-dist/legacy/build/pdf.worker.min.js ../assets/vendor/pdfjs/pdf.worker.min.js
```

> If a future upgrade past v3 is needed, `flipbook.js` would need to switch to
> loading pdf.js as an ES module (`<script type="module">` + assigning the
> import result onto `window.pdfjsLib` manually) instead of a plain script
> tag — that's a real code change, not just a re-vendor.
>
> Also confirm the text-layer entry point for the version you pull in —
> `flipbook.js` calls `pdfjsLib.renderTextLayer(...)` and feature-detects it,
> but some versions expose a `TextLayer` class instead. v3.11.174 exposes
> `renderTextLayer` as a function, matching what `flipbook.js` expects.

## 2. StPageFlip (`page-flip`, MIT)

```
cd ..
mkdir pageflip-tmp && cd pageflip-tmp
npm init -y
npm install page-flip@latest
cp node_modules/page-flip/dist/js/page-flip.browser.js ../assets/vendor/pageflip/page-flip.browser.js
```

This exposes `window.St.PageFlip`, which `flipbook.js` expects.

## 3. Clean up

```
cd ..
rm -rf pdfjs-tmp pageflip-tmp
```

You should end up with:

```
assets/vendor/pdfjs/pdf.min.js
assets/vendor/pdfjs/pdf.worker.min.js
assets/vendor/pageflip/page-flip.browser.js
```

## 4. Verify

Load the plugin's admin "Report Flipbook" page and drop in a small test PDF —
if the preview renders and pages flip, both libraries are wired correctly.
Open the browser console for any 404s (wrong file paths) or "X is not a
function" errors (API mismatch from the version pulled — see the notes
above).
