# The TraceProvider Interface

PlanTrace's Trace step doesn't know or care whether its geometry came from a
deterministic demo, a future OpenCV pipeline, or a future ML service — it
only knows the `TraceProvider` contract, defined in
`public/assets/plan/trace-provider.js`:

```js
class TraceProvider {
  id = 'my-provider-id';       // stored on every element this provider proposes
  label = 'My Provider';       // shown in the UI / review queue

  async trace(context) {
    // return { elements: [ { type, geometry, confidence, findings?, sourceRegion? }, ... ] }
  }
}
```

`context` (built by `PlanDocumentStore.runTraceProvider()`) is:

```js
{
  sheetId, sheetName,
  naturalWidth, naturalHeight,   // the sheet's current working pixel size
  prep,                          // sheet.prep — rotation/crop/brightness/contrast/grayscale/opacity
  calibration,                   // sheet.calibration — unit/pixelsPerUnit/points/realLength
}
```

Each proposed element in the returned array is:

```js
{
  type: 'wall',                 // one of the eight geometry types — see docs/PROJECT-FORMAT.md
  geometry: { x1, y1, x2, y2, thickness },   // world coordinates, type-specific shape
  confidence: 0.87,             // 0..1
  findings: [ { severity: 'warning', message: '...', code: 'wall-junction' } ],  // optional
  sourceRegion: { x, y, w, h }, // optional — the source-pixel region this element was traced from
}
```

`PlanDocumentStore.runTraceProvider(sheetId, provider, options)` calls
`provider.trace(context)`, stamps every returned element with a stable id,
`layerId` (from the type), `status: 'proposed'`, and
`provider: { id, label }`, then **replaces** the sheet's geometry with the
result inside a single undo step. Providers never touch the store directly;
the store is what turns proposals into real, reviewable elements.

## `DemoTraceProvider`

`public/assets/plan/demo-trace-provider.js` implements this interface
without looking at any actual pixels. It:

1. Derives a seed by hashing `sheetId` (+ an optional `demoLayout` hint), so
   **the same sheet always retraces to the same geometry** — required for
   repeatable manual QA and for the "Re-run trace" confirmation to make sense.
2. Lays out a plausible floor-plan skeleton (exterior walls, a few interior
   partitions, doors, windows, a stair, a couple of fixtures, room labels,
   and perimeter dimension lines) in a normalized box, then scales it to the
   sheet's actual `naturalWidth`/`naturalHeight`.
3. Deliberately gives ~22% of elements a lower confidence score and an
   attached finding (drawn from a small pool: uncertain wall junctions,
   dimension conflicts, ambiguous door swings, unclear window types, unclear
   room boundaries, estimated stair runs, guessed fixture types, hard-to-OCR
   text) — so a freshly-traced sheet always has something real to review,
   the same way a real vision pipeline's uncertain outputs would.

Three `demoLayout` variants (`'roof'`, `'first-floor'`, `'second-floor'`)
exist purely to give the built-in three-sheet demo project visual variety;
running the demo provider against a real imported sheet (Prepare step → "Run
Demo Trace Provider") uses the default `'generic'` single-footprint layout,
sized to whatever image was imported.

## Adding a real provider later

A future OpenCV/ML-backed provider would:

1. Implement `trace(context)` — likely `fetch()`-ing a server endpoint with
   the sheet's prepared raster and getting geometry back.
2. Register itself: `traceProviderRegistry.register(new MyProvider())`
   (`TraceProviderRegistry` is in `trace-provider.js`, currently unused by
   the UI beyond being available — the Prepare panel calls
   `demoTraceProvider` directly since it's the only provider that exists
   today).
3. Nothing else changes. `PlanDocumentStore.runTraceProvider()`, the Review
   queue, confidence badges, findings, and every downstream consumer already
   treat "a provider's proposals" as the unit of work — they were built
   against this interface, not against `DemoTraceProvider` specifically.
