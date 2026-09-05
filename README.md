# PlanTrace

_Built against the mockup in [`docs/ui-mockup.png`](docs/ui-mockup.png)._

Convert a scanned floor plan into reviewable CAD geometry: **Prepare** the
source sheet, run **Trace** to propose walls/doors/windows/etc., work the
**Review** queue, then **Export** DXF/SVG/JSON.

PlanTrace is a static-HTML, vanilla-ES-module, native-Web-Components
application. No build step, no bundler, no framework, no npm/Composer
runtime dependency. PHP's only job is serving files.

## Run it

```sh
php -S localhost:8080 -t public public/router.php
```

Then open <http://localhost:8080/>. That's the whole setup — no `npm
install`, no compile step. First run boots a small built-in demo project
("800 Green Street," three synthetic sheets) since real blueprint scans
weren't available to seed the demo with; see "Demo content" below.

Requires PHP 8.2+. Any evergreen desktop browser (Chrome/Edge/Firefox/Safari)
works — the app leans on Pointer Events, `<dialog>`, `structuredClone`,
`AbortController`, IndexedDB, and native Custom Elements/SVG.

### Deploying to Apache

Yes — point `DocumentRoot` at `public/` (mod_php or PHP-FPM) and you're done;
`public/.htaccess` handles the rest, and `AllowOverride All` needs to be set
for that directory so it's actually read:

```apache
<VirtualHost *:80>
    DocumentRoot /path/to/plantrace/public
    <Directory /path/to/plantrace/public>
        AllowOverride All
        Require all granted
    </Directory>
</VirtualHost>
```

`router.php` is specifically for `php -S`'s router-script requirement and
isn't used by Apache at all — Apache serves real files (`app.js`, `app.css`,
icons, …) directly, same as the built-in server does. The only thing
`.htaccess` adds is routing `/api/…` to `public/api/index.php` and falling
back to `index.html` for any other non-file path — PlanTrace has no
client-side routes of its own today (workflow steps are in-memory state,
not URLs), so that fallback is mostly future-proofing rather than something
the app currently relies on. `mod_rewrite` needs to be enabled
(`a2enmod rewrite`). Verified against a real standalone Apache 2.4 + PHP 8.2
instance during development: static assets, `/api/health`, and the SPA
fallback all returned the expected responses, and the app booted with zero
console errors under it.

### Serving PlanTrace from a subdirectory of an existing site

PlanTrace's own HTML/CSS/JS never hard-code a path — every asset reference
and module import is relative, and there isn't a single `fetch()` call in
the app (persistence is IndexedDB-only) — so the *client* already works
mounted anywhere. The one place a subdirectory mount needs to be told about
itself is `public/api/index.php`'s path matching, since
`$_SERVER['REQUEST_URI']` still carries the full, unmounted-relative path
(e.g. `/plantrace/api/health`) even once Apache's `.htaccess` has routed the
request to the right file.

Copy `.env.example` to `.env` (same directory as this README) and set:

```sh
# Served at https://example.com/plantrace/ instead of the site's root:
APP_BASE_PATH=/plantrace
```

Then mount it with an `Alias` into whatever site already owns that domain —
you do **not** need a dedicated `<VirtualHost>`:

```apache
Alias /plantrace /path/to/plantrace/public
<Directory /path/to/plantrace/public>
    AllowOverride All
    Require all granted
</Directory>
```

`.env` also accepts `APP_ROOT_PATH` (absolute filesystem path to this
project's root) for the rarer case where `public/` is reached through a
symlink and PHP's own "parent of this script" path detection shouldn't be
trusted — leave it blank otherwise. Both variables are read by
`src/Support/BasePath.php`; a real environment variable of the same name
(set by a hosting panel, systemd unit, etc.) always wins over `.env`.

This was verified the same way as the root-mount case above, but with
Apache's `DocumentRoot` pointed at an unrelated directory and PlanTrace
reached only via `Alias /plantrace-sub` — static assets, `/api/health`, and
the SPA fallback all resolved correctly under the subdirectory, and so does
`php -S` locally once `.env` sets `APP_BASE_PATH` (handy for testing a
subdirectory deployment without standing up Apache at all).

## What's here

- **Prepare** — import JPG/PNG/WebP (PDF is accepted but explained-not-
  implemented, see below), rotate in 90° steps, crop, adjust brightness/
  contrast/grayscale/opacity, calibrate a known dimension, set drawing
  units, reorder/rename sheets, run the trace provider.
- **Trace** — an SVG CAD overlay on the raster: select/move elements and
  endpoints, draw walls, insert doors/windows, add dimensions, ortho +
  snapping toggles, adjustable grid, undo/redo, fit view.
- **Review** — the centerpiece: every proposed element carries a confidence
  score, a status (`proposed`/`verified`/`corrected`/`rejected`), a
  provider id, and optional findings. Filter/sort the queue, accept/fix/
  reject, accept everything above a confidence threshold, keyboard-navigate
  (`J`/`K`, `A`, `R`), and watch the verification ring/counts update live.
- **Export** — project JSON (round-trips through the same normalizer that
  guards import), standalone SVG, and a minimal valid ASCII DXF with
  `WALLS`/`DOORS`/`WINDOWS`/`STAIRS`/`FIXTURES`/`DIMENSIONS`/`TEXT`/
  `SOURCE_REFERENCE` layers. Every export path carries the same message:
  **this is a starting point, not a construction document — verify against
  field measurements.**

See `docs/ARCHITECTURE.md` for how it's built, `docs/PROJECT-FORMAT.md` for
the document schema, and `docs/TRACE-PROVIDER.md` for the geometry-proposal
interface (and how a real OpenCV/ML provider would slot in later).

## Fully functional

- The complete Prepare → Trace → Review → Export loop, including undo/redo
  (a whole pointer drag = one undo step), IndexedDB persistence with
  debounced autosave + a save-state indicator, and portable JSON backup.
- Import → source-adapter boundary → new sheet, for real JPG/PNG/WebP files
  (validated by size/type, corrupt/undecodable images are caught and
  reported rather than crashing anything).
- Raster + SVG stay pixel-registered through pan/zoom in every view mode,
  including **Split view**, where the source and reconstructed geometry are
  two independently-clipped panes driven by the exact same viewport
  transform (see `docs/ARCHITECTURE.md`).
- Layer visibility/color, source-image opacity (shared between the Prepare
  slider and the Layers panel slider — one underlying value), sheet
  reorder/rename/delete (with confirmation).
- Nondestructive prep: the original upload is never modified; rotation/crop
  are baked into a derived asset, brightness/contrast/grayscale/opacity are
  live CSS filters.
- Calibration: click two points on the canvas, enter a real-world length,
  every dimension label and the status bar's cursor readout switch to real
  units immediately.

## Intentionally stubbed

- **PDF rasterization.** Per the brief: rather than pull in a PDF-rendering
  dependency, PlanTrace implements the full upload/adapter boundary
  (`plan/source-adapters.js`) and shows a clear explanation when a `.pdf` is
  dropped, pointing the user at exporting a page as an image instead. Raster
  formats are fully supported.
- **Real computer vision.** `DemoTraceProvider` is deterministic and
  synthetic — it lays out a plausible floor plan sized to the sheet, with a
  realistic mix of confidence levels and findings, but it does not look at
  actual pixels. The `TraceProvider` interface it implements is the seed for
  a real service later (`docs/TRACE-PROVIDER.md`).
- **Server-side persistence.** Projects live in the browser (IndexedDB) plus
  portable JSON. `public/api/index.php` + `src/Http/JsonResponse.php`
  establish the `/api/` boundary a future PHP/MySQL `ProjectRepository`
  would occupy, but there's no database in this phase — building one wasn't
  the goal of the UI phase.
- **Narrow-screen layout.** The CSS collapses the side panels on narrow
  viewports so nothing overlaps unusably, but there's no touch-first mobile
  redesign — desktop is the primary environment, per the brief.

## Demo content

The brief's fallback path: real blueprint photographs weren't available in
the working directory (only a UI mockup image), so the built-in demo is a
**small synthetic vector document** — three sheets ("Roof Plan," "First
Floor," "Second Floor") with no source raster, generated by running the same
`DemoTraceProvider` a real import would use, then pre-marking most elements
verified so Review has something to demonstrate on first load. Nothing here
embeds an absolute filesystem path; "Load demo project" (shown on the empty
canvas, and reachable any time via Settings → Clear all local projects) can
always regenerate it.

## Manual QA checklist

Everything below was verified against a running instance during
development, mostly via a headless-Chromium + CDP script driving the real
app (real pointer drags, real `File`/`DataTransfer` drops, a real reload for
persistence) rather than by inspection alone.

- [x] `php -S localhost:8080 -t public public/router.php` serves the app; no
      build command needed.
- [x] Importing a valid JPG/PNG/WebP creates a new sheet with correct
      dimensions; a corrupt image is caught and reported, not silently
      accepted.
- [x] Dropping a `.pdf` shows the explanatory message and creates no sheet.
- [x] Pan and zoom keep raster and vector registered (Fit-to-view, and the
      Split-view divider drag, were driven programmatically and the two
      panes' computed transforms were asserted equal).
- [x] Selecting an element and dragging it moves it; the whole drag produces
      exactly one undo step, and undo/redo restore the exact prior/next
      geometry.
- [x] Layer visibility toggling removes/restores that layer's elements from
      the rendered scene.
- [x] Accept / Fix / Reject update the element's status, the review queue's
      filtered list, and the verification ring/counts; "Fix" selects and
      visually emphasizes the element, and the next geometry edit on it
      auto-promotes it to `corrected`.
- [x] Autosave survives a full page reload (project rename and a newly
      imported sheet were both confirmed present after reloading).
- [x] JSON export → import round-trips the document (sheet count, project
      name, and per-sheet geometry counts all verified equal).
- [x] DXF export is triggered from the header's "Export DXF" button (a real
      `Page.downloadWillBegin` was observed) and its content includes valid
      `HEADER`/`TABLES`/`BLOCKS`/`ENTITIES`/`EOF` sections with the required
      layers and flipped-to-Y-up drawing coordinates.
- [x] SVG export produces a standalone, valid SVG document.
- [x] Workflow navigation (Prepare/Trace/Review/Export) swaps the main
      panel correctly; Export is a one-shot action rather than a persistent
      view (see `docs/ARCHITECTURE.md`).
- [x] Undo/redo header buttons correctly enable/disable with history state.
- [x] Ortho and Snapping toggles in the status bar flip `settings.ortho`/
      `settings.snapping` and are read by the active drag/draw.
- [x] Wall drawing (click–click–double-click) and the Erase tool were
      exercised directly and produced the expected element count deltas.
- [x] Sheet deletion requires confirmation; canceling leaves the sheet count
      unchanged.
- [x] Calibration: picking two points on the canvas (via the `calibrate`
      tool mode) and entering a real length produces the expected
      `pixelsPerUnit`.
- [x] Zero uncaught console errors or unhandled promise rejections across
      every scenario above.

Not covered by the automated pass above — spot-checked by inspection instead
of a scripted assertion — and worth a human's second look: real
click-and-drag wall/door/window drawing with the mouse (the logic was
exercised directly; the pointer-coordinate path shares the same code but
wasn't independently driven pixel-by-pixel), the Settings dialog's "clear
all local data" destructive action, and narrow-viewport sidebar collapsing.

### A note on one bug this process actually caught

Early manual/visual QA (a headless screenshot) surfaced a real CSS cascade
issue worth naming: several components toggle the `hidden` attribute on
elements whose class *also* sets `display` unconditionally (e.g.
`.pt-workspace-empty { display: grid }`). Per the CSS cascade, a normal
author rule beats the user-agent's `[hidden] { display: none }` regardless
of specificity — so `el.hidden = true` was silently a no-op on several
elements (an empty-state panel, a callout, the Properties/Issues tab
switch, the Split-view divider). Fixed with one global rule
(`[hidden] { display: none !important; }` in `app.css`) rather than special-
casing each component. Left here because it's the kind of bug that's
invisible from reading the code and only shows up once you actually look at
the rendered page.

## Accessibility

Semantic buttons/controls throughout, `aria-label`s on every icon-only
button, visible focus rings (`:focus-visible`), native `<dialog>` for every
modal (focus-trapped, restores focus on close), status conveyed by more than
color (badges carry text, not just a colored dot), keyboard navigation
through the review queue, and `prefers-reduced-motion` support.

## Security notes

Every user-controllable string (project/sheet names, text-element content,
finding messages, layer names, provider labels) is passed through `esc()`
before landing in `innerHTML`. Imported project JSON is normalized/validated
before it ever reaches the store — malformed input is dropped, not trusted.
Uploaded files are checked by size and MIME type before decoding. Object
URLs for source images are revoked when superseded. Destructive actions
(sheet delete, clear-all-data) require confirmation.
