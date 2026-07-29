# Testing

Two automated layers plus a short manual checklist. All test tooling is
**dev-only** and never ships in the plugin zip (see `BUILD.md` / the
`export-ignore` rules in `.gitattributes`).

| What | How | Needs |
|------|-----|-------|
| Plugin logic (PHP) | PHPUnit in a real WordPress | Node + Docker |
| Viewer + UI | Playwright against the standalone preview | Node |

The tests deliberately assert **user-visible behaviour** (the PDF loads, Next
advances the page, controls are labelled, errors fall back) — not styling,
pixel sizes, or internal class names — so they don't break every time we tweak
the look.

## One-time setup

```
npm install                 # Playwright + wp-env
npx playwright install      # browser binaries
composer install            # PHPUnit + WP test framework (for the PHP layer)
```

## Layer 1 — Viewer + UI (Playwright)

Drives the real viewer through `preview.html` / `admin-preview.html` — no
WordPress required. A static server starts automatically.

```
npm run test:e2e            # run headless
npm run test:e2e:ui         # interactive runner
```

Covers: the PDF loads and shows pages; Next/Previous change the page; the
Previous/Next/Fullscreen/Download controls exist with accessible names; the
download link points at the PDF; a missing PDF shows an error + download
fallback; and the admin dropzone previews a chosen PDF.

## Layer 2 — Plugin logic (PHPUnit + wp-env)

Runs against a throwaway WordPress in Docker, so it exercises the real plugin
(no mocks). Start Docker Desktop first.

```
npm run env:start           # boots WordPress in Docker (first run downloads it)
npm run test:php            # runs PHPUnit inside the container
npm run env:stop            # when you're done
```

Covers: the width sanitizer/size-preset logic; `arfb_render_flipbook()` /
`arfb_render_block()` output (PDF URL wired in, download fallback, size applied,
"no PDF" notice for editors only, fallback to the saved default); and the
admin-ajax "save default report" handler's security/validation (nonce,
capability, PDF-only, and a successful save).

## Manual checklist (pre-release)

A few things are visual/gesture-based and aren't worth asserting automatically
(doing so would mean testing implementation details). Spot-check these by hand
in `preview.html`:

- [ ] **Zoom** — Ctrl/⌘+scroll (or trackpad pinch) magnifies toward the cursor
      and text stays crisp; drag pans; double-click and turning the page reset.
- [ ] **Fullscreen** — the button fills the screen and the spread fits without
      the bottom being cut off. (The Fullscreen API is unreliable in headless
      browsers, so this is manual.)
- [ ] **Responsive/mobile** — the page-flip animation and the side arrows look
      right at a few widths (wide desktop, ~tablet, narrow/phone).

## Notes

- The fixture `tests/fixtures/sample.pdf` is a small committed multi-page PDF the
  Playwright tests load.
- Packaging the plugin for distribution is documented separately in `BUILD.md`.
