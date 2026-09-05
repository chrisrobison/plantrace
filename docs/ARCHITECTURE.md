# PlanTrace Architecture

PlanTrace converts scanned floor-plan/blueprint images into reviewable CAD
geometry through a four-step workflow: **Prepare → Trace → Review → Export**.
It is a static-HTML, vanilla-ES-module, native-Web-Components application —
no build step, no framework, no npm/Composer runtime dependencies. PHP's only
job is serving files and reserving a boundary for a future server API.

This document explains the shape of the code and the decisions behind it.
See also: `docs/PROJECT-FORMAT.md` (the document schema) and
`docs/TRACE-PROVIDER.md` (the geometry-proposal interface).

## Reference architecture

The project follows the development philosophy of
[chrisrobison/panic-backstage](https://github.com/chrisrobison/panic-backstage),
specifically:

- **`core.js` base element pattern** — a tiny `PtElement extends HTMLElement`
  (mirroring Panic's `PanicElement`) allocates an `AbortController` in
  `connectedCallback`, calls a component-specific `connect()`, and aborts
  every listener in `disconnectedCallback`. Every `pt-*` component extends it.
- **Event-delegated canvas + one shared world transform**, following the
  pattern in `public/assets/processes/process-canvas.js`: a single
  `translate()/scale()` on a "world" container, one pointerdown handler at
  the canvas root, pointer capture for drags, and math-based hit-testing
  instead of a listener per shape.
- **Whole-document snapshot undo/redo with transactions and batches**,
  following `public/assets/processes/graph-store.js`'s `ProcessGraphStore`:
  `structuredClone()` snapshots, `transaction(label, fn)`, and an explicit
  `beginBatch()/endBatch()` pair so an entire pointer drag becomes one undo
  step.
- **A small PHP front-controller/router**, following the shape of
  `src/Kernel.php` / `src/Request.php` / `src/Response.php`, scaled down to
  what this phase actually needs (see "PHP" below).

No Panic Backstage branding, venue/booking domain logic, or authentication
was carried over — only the architectural patterns.

## Layers

```
public/
  index.html            single HTML shell — everything else is JS/CSS
  router.php            php -S front controller (static files, /api/, SPA fallback)
  api/index.php          minimal API shell (see "PHP" below)
  assets/
    app.css              design tokens + every component's styles (light DOM, shared sheet)
    core.js              $, esc, PtElement, message bus, toast stack, dialog helpers
    app.js               entry point — imports core.js + the app shell
    icons/icons.js        dependency-free inline-SVG icon set
    plan/                 pure logic — no DOM, no customElements — see below
    components/            pt-* Web Components — see below
```

### `plan/` — pure logic modules

Every file here is DOM-free and could be exercised from a plain Node script
(and was, during development — see the manual QA checklist in the README).
This is deliberate: geometry math, snapping, schema validation, review
scoring, and file export are exactly the parts of a CAD tool worth keeping
provable and boring.

| File | Responsibility |
|---|---|
| `plan-schema.js` | Document/sheet/element shape, defaults, `normalizeDocument()`/`validateDocument()` |
| `geometry.js` | Distance, bbox, hit-testing, endpoint editing, door-swing math |
| `snapping.js` | Grid snap, ortho constraint, endpoint/midpoint snap resolution |
| `units.js` | Pixel ⇄ real-world conversion and formatting (`12'-6"`, `3.2 m`, …) |
| `primitives.js` | One element → `{line, polyline, arc, circle, text}` primitives, shared by the renderer, SVG export, and DXF export |
| `review.js` | Verification stats, issue filtering/sorting, issue titles |
| `trace-provider.js` | The `TraceProvider` interface + a registry |
| `demo-trace-provider.js` | Deterministic demo provider (see TRACE-PROVIDER.md) |
| `demo-project.js` | Builds the built-in three-sheet showcase project |
| `source-adapters.js` | File → pixels adapter boundary (raster supported, PDF stubbed) |
| `raster-prep.js` | Bakes rotation/crop into a derived raster via `<canvas>` |
| `svg-export.js` / `dxf-export.js` / `json-export.js` | The three export formats |
| `indexeddb-project-repository.js` | The only file that touches IndexedDB |
| `plan-document-store.js` | `PlanDocumentStore` — see next section |

### `components/` — Web Components

One `pt-*` custom element per file, each self-registering via
`customElements.define()` on import. `pt-app-shell.js` is the only file that
imports the others and wires them together; every other component talks to
its siblings only through `PlanDocumentStore` events or the app-wide `bus`
(see "State" below) — never by reaching into another component directly.

## State: `PlanDocumentStore`

`PlanDocumentStore extends EventTarget` (in `plan/plan-document-store.js`) is
**the only code allowed to mutate the plan document.** Every component
publishes intent by calling a store method (`store.moveElements(...)`,
`store.setElementStatus(...)`, …); nothing outside the store ever writes to
`store.document` directly.

The store owns:

- **Persisted, undo-tracked state** (`this.document`): project metadata,
  sheets, geometry, layers, review status/findings, calibration, viewport,
  editor settings (grid/snap/ortho).
- **Persisted, non-undoable state**, mutated via `_mutate()` instead of
  `transaction()`: active sheet, viewport pan/zoom. (Undoing "which sheet you
  were looking at" is not a useful undo step.)
- **Ephemeral state**, never persisted and never in undo history: `selection`
  (a `Set`), `toolMode`, `viewMode`, `saveState`, `fixTargetId`,
  `workflowStep`, `cursor`.

Undo/redo is whole-document `structuredClone()` snapshotting, not an
inverse-command stack — see the comment at the top of
`plan-document-store.js` for why (mirrors `graph-store.js`'s reasoning:
cheap at this document size, far less code, far fewer ways to get an inverse
operation subtly wrong). `transaction(label, fn)` pushes one snapshot;
`beginBatch(label)`/`endBatch()` let a whole pointer drag — many `transaction`
calls in a row — collapse into that same one snapshot, because `transaction`
only pushes when no batch is already open.

Two event channels exist on purpose:

1. **`PlanDocumentStore`'s own `EventTarget`** (`change`, `selection`,
   `toolmode`, `viewmode`, `workflowstep`, `savestate`, `cursor`, `fix`) —
   for frequent, editor-local updates. Every `pt-*` component that cares
   about document state subscribes here.
2. **The app-wide `bus`** (`core.js`) — for cross-feature notifications that
   aren't document state: toasts, "please open the import dialog", "please
   open the export panel", workflow navigation side effects. Exactly the
   split the brief asks for.

## Rendering: the workspace

`pt-plan-workspace.js` renders a viewport-clipping layer containing one (or,
in Split view, two) "world" layers, each a single `translate()/scale()` CSS
transform shared by a raster `<img>` and an SVG scene:

```
pt-plan-workspace
  .pt-viewport                (clips to the component's own bounds)
    .pt-pane                  (one, or two in Split view — see below)
      .pt-world               (the ONE shared transform: translate(x,y) scale(z))
        .pt-world-surface
          img.pt-raster-img   (source raster, CSS-filtered for brightness/contrast/grayscale/opacity)
          svg.pt-scene-svg    (grid pattern + geometry + selection/handles/draft, in world coordinates)
```

Geometry is SVG, not `<canvas>`, specifically so each element keeps semantic
identity (`data-el-id`, `data-type`, `role="img"` + `aria-label`), is
individually stylable by CSS class + `data-status`/`data-selected` attribute,
and is inspectable in devtools — the brief's explicit reasoning, restated
here because it drove several other decisions (e.g. hit-testing is done in
JS against the geometry array, not by attaching a listener to every SVG
shape).

**Split view** renders the SAME geometry/raster into two sibling `.pt-pane`
elements — `splitRaster` (raster only) and `splitVector` (geometry only) —
both driven by the identical `sheet.viewport` values. A `clip-path: inset()`
on each pane (computed from the divider's on-screen position, not from world
coordinates) shows only its half. Because both panes share one transform
source of truth, panning/zooming can never desync the two halves — there is
no separate "raster viewport" and "vector viewport" to drift apart.

**Interaction** is delegated at the workspace root: one `pointerdown`
listener inspects `store.toolMode`, resolves the click to a handle / element
/ empty space via math (`geometry.js`'s `hitTestElement`, not DOM lookups),
and drives the rest of the gesture with `setPointerCapture` +
`pointermove`/`pointerup`. No listener is ever attached to an individual
line or handle.

## Preparation transforms

Brightness/contrast/grayscale/opacity are applied live as CSS `filter`/
`opacity` — cheap, reversible, no re-encoding. Rotation and crop are
different: they change the pixel grid that geometry coordinates are measured
against, so they're baked into a derived raster (`plan/raster-prep.js`, via
`<canvas>`) whenever changed, stored as a *second* asset
(`sheet.preparedAssetId`) alongside the untouched original
(`sheet.assetId`). The original file is never modified — "nondestructive"
here means the recipe (`sheet.prep`) is always kept, not merely that a
`<canvas>` bake is deferred.

## Persistence

`plan/indexeddb-project-repository.js` is the only file that calls
`indexedDB.*`. It exposes `list/load/save/remove` for project documents and
`saveAsset/loadAsset/removeAsset` for source-image blobs (kept as `Blob`s,
never base64 — large images must not end up in `localStorage` per the
brief). Everything else — components, the store — talks to this repository
through that same small interface, which is the seed of the "future
PHP/MySQL repository" the brief asks for: swap this file's internals for
`fetch()` calls against `public/api/`, and no UI component changes.

`pt-app-shell.js` wires autosave: a debounced (800ms) listener on the
store's `change` event calls `repository.save()`, flips `store.saveState`
through `saving → saved`/`error`, and the header's save indicator reflects
that. Portable JSON export/import (`plan/json-export.js`) is the explicit
backup path, independent of IndexedDB.

## PHP

There is no server-side project storage in this phase — see "Persistence"
above. `public/router.php` exists only because `php -S` requires a router to
serve a single-page app's non-file routes; `public/api/index.php` +
`src/Http/JsonResponse.php` are a deliberately tiny stand-in for the
Kernel/Request/Response trio Panic Backstage uses, so that boundary is real
and occupies the right URL space (`/api/`) without inventing a database this
phase doesn't need.

`src/Support/Env.php` (a hand-rolled `.env` reader — no Composer dependency)
and `src/Support/BasePath.php` let the whole app be mounted under any URL
subdirectory of an existing site (`APP_BASE_PATH`) and, independently, live
at any filesystem location (`APP_ROOT_PATH`) — see the README's "Serving
PlanTrace from a subdirectory" section. Both `router.php` and
`api/index.php` go through `BasePath` rather than reading
`$_SERVER['REQUEST_URI']` directly, which is the only reason either of them
needs to know about a mount path at all — nothing in the client-side app
does, by construction (every asset reference and module import is relative,
and the client never calls the API).

## What is NOT here on purpose

- No bundler, transpiler, or npm/Composer runtime dependency.
- No canvas-only rendering — see "Rendering" above.
- No client-side router/URL-based navigation — the app is one page; workflow
  steps are view state (`store.workflowStep`), not routes.
- No real computer-vision tracing — `DemoTraceProvider` is deterministic and
  synthetic by design (see `docs/TRACE-PROVIDER.md`); the rest of the app
  treats its output exactly as it would a future OpenCV/ML service's.
