# Building & releasing the plugin

The distributable plugin zip is built **reproducibly from git**, so the same
commit always produces the same package — for every teammate and for CI. The
list of what ships vs. what's excluded lives in **`.gitattributes`**
(`export-ignore` rules), so it's shared and reviewed like any other code, not
kept in one person's local script.

## Build the zip locally

```
npm run build:zip
```

That runs:

```
git archive --format=zip --prefix=annual-report-flipbook/ -o annual-report-flipbook.zip HEAD
```

- The only requirement is **git** (the npm script is just a convenient wrapper).
- Output: `annual-report-flipbook.zip` in the project root, containing a single
  top-level `annual-report-flipbook/` folder — the layout WordPress expects for
  **Plugins → Add New → Upload Plugin**.

> **Builds from the last commit.** `git archive` packages committed content, not
> your working tree. **Commit your changes first** (including `.gitattributes`)
> so the zip reflects them — otherwise you'll ship an older state. This is the
> point of the approach: a release always matches a known commit.

To package a specific past release instead of the latest commit, pass a tag:

```
git archive --format=zip --prefix=annual-report-flipbook/ -o annual-report-flipbook.zip v1.0.0
```

## What's in the zip

Included: `annual-report-flipbook.php`, `readme.txt`, `includes/`, and `assets/`
(CSS, JS, and the vendored PDF.js / StPageFlip).

Excluded (via `export-ignore` in `.gitattributes`): all dev/test tooling —
`tests/`, `package.json`, `playwright.config.js`, `composer.json`,
`phpunit.xml.dist`, `.wp-env.json`, the standalone `preview.html`, and the
dev docs (`SETUP.md`, `TESTING.md`, `BUILD.md`).

Verify the contents after building:

```
unzip -l annual-report-flipbook.zip
```


1. Bump the version in **two** places: `Version:` in `annual-report-flipbook.php`
   and `Stable tag:` in `readme.txt`.
2. Commit, then tag and push:
   ```
   git commit -am "Release 1.0.1"
   git tag v1.0.1
   git push && git push --tags
   ```
3. Build the zip from that tag and distribute it however the project is
   currently hosting downloads:
   ```
   git archive --format=zip --prefix=annual-report-flipbook/ -o annual-report-flipbook.zip v1.0.1
   ```

Because the zip is built from a tag rather than a working tree, anyone running
that command against the same tag gets a byte-identical package — the tag is
what makes a release reproducible, not the tooling around it.

## Installing the built zip

WordPress admin → **Plugins → Add New → Upload Plugin** → choose
`annual-report-flipbook.zip` → **Install Now** → **Activate**.
