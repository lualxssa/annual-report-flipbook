# Setup: vendoring PDF.js and StPageFlip

This plugin loads two open-source JS libraries from its own `assets/vendor/`
folder rather than a CDN (more reliable, works offline, no third-party
tracking/availability risk on your site). Both are **already committed** to
`assets/vendor/`, so a fresh clone runs as-is — there is no setup step
before the plugin works.

This document records where those files came from and which versions to use,
so follow it when **upgrading** either library or re-vendoring from scratch.
The steps need a machine with Node.js; the WordPress site itself never does.

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

Copy the **legacy UMD build** (`.js`, not `.mjs`). The file opens with Mozilla's
Apache-2.0 `@licstart` banner; immediately after it comes the webpack UMD
wrapper (`!function webpackUniversalModuleDefinition`), and it ends with a
webpack IIFE — not an `export{...}` statement:

```
cp node_modules/pdfjs-dist/legacy/build/pdf.min.js        ../assets/vendor/pdfjs/pdf.min.js
cp node_modules/pdfjs-dist/legacy/build/pdf.worker.min.js ../assets/vendor/pdfjs/pdf.worker.min.js
```

Expected SHA-256 for 3.11.174 — the copies currently committed match these
byte-for-byte:

```
978fd1b2d134a98e98966186a97777bebf87d8e770dadab1ece3687e21a5aa6c  pdf.min.js
38cde5311957b86bc3669f93e7d2566de333a90055ed6635bef60d9bf00e96f2  pdf.worker.min.js
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

**Pin the version.** The bundle carries no version string, copyright, or license
banner, so once it is copied into `assets/vendor/` nothing in the file records
which release it came from — the pin here is the only record:

```
cd ..
mkdir pageflip-tmp && cd pageflip-tmp
npm init -y
npm install page-flip@2.0.7
cp node_modules/page-flip/dist/js/page-flip.browser.js ../assets/vendor/pageflip/page-flip.browser.js
```

Expected SHA-256 — the committed copy matches this byte-for-byte:

```
bbaca0bbef57a22bb66a3fc69d67baf9a17fb9a9c89ec9ed35e2b91abe4bd1e7  page-flip.browser.js
```

This exposes `window.St.PageFlip`, which `flipbook.js` expects.

> **Why pinned, when nothing here is broken.** The committed file *is* the
> dependency — re-running this section regenerates an artifact that ships to
> every site, so it has to be reproducible. If two people re-vendor on different
> days and get different bytes, a diff on a 44 KB minified file is unreviewable
> and an accidental upgrade is indistinguishable from an intentional one. The
> Playwright suite also asserts viewer behaviour built on this library's API, so
> a silent version change quietly changes what those tests mean.
>
> Upgrading is still fine — just make it deliberate: bump the version here in the
> same commit as the new bytes, re-run the tests, and say so in the commit
> message.
>
> 2.0.7 was published **2021-04-18** and is still the `latest` tag, so
> `page-flip@latest` happened to resolve to it for years. That is luck, not a
> guarantee: upstream ([Nodlik/StPageFlip](https://github.com/Nodlik/StPageFlip))
> has published nothing since, but the day it does, `@latest` would silently pull
> code that was never tested here. Note also that a dormant upstream means no
> security or browser-compatibility fixes are coming — if this library ever
> breaks on a future browser, the fix is ours to write or fork.

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

First check you copied what you meant to. From the project root:

```
sha256sum assets/vendor/pdfjs/pdf.min.js \
          assets/vendor/pdfjs/pdf.worker.min.js \
          assets/vendor/pageflip/page-flip.browser.js
```

Those must match the three hashes above. Because neither `package-lock.json` nor
`composer.lock` is committed, this is the only reproducible provenance check the
project has — anyone can confirm a vendored file is the unmodified npm release
with `npm pack page-flip@2.0.7` (or `pdfjs-dist@3.11.174`) and `cmp`.

Then confirm it actually runs:

Load the plugin's admin "Report Flipbook" page and drop in a small test PDF —
if the preview renders and pages flip, both libraries are wired correctly.
Open the browser console for any 404s (wrong file paths) or "X is not a
function" errors (API mismatch from the version pulled — see the notes
above).
