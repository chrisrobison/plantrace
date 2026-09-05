# PlanTrace Project Format

This is the normalized, versioned document schema produced and consumed by
`public/assets/plan/plan-schema.js`. It is what `PlanDocumentStore` holds in
memory, what gets written to IndexedDB, and what "Export project JSON"
downloads verbatim — there is exactly one document shape in this app.

Anything parsed from outside (an uploaded JSON file, a hand-edited fixture)
goes through `normalizeDocument()` first, which fills in defaults and
**drops** anything it can't make sense of rather than trusting it — see
`validateDocument()`/`normalizeDocument()`/`normalizeSheet()`/
`normalizeElement()` for the exact rules. Importing a corrupt or foreign
file can produce warnings; it cannot corrupt editor state.

## Top level

```jsonc
{
  "version": 1,
  "project": { "id": "proj_...", "name": "800 Green Street", "createdAt": "...", "updatedAt": "..." },
  "sheets": [ /* Sheet, see below */ ],
  "activeSheetId": "sheet_...",
  "settings": { "gridSize": 12, "gridUnit": "in", "snapping": true, "ortho": true }
}
```

`settings.gridSize` is always in **inches** regardless of the sheet's
display unit (see "Units" below) — a display-unit switch never has to
reinterpret it.

## Sheet

```jsonc
{
  "id": "sheet_...",
  "name": "First Floor",
  "order": 0,
  "originalFilename": "first-floor-scan.jpg",   // or null for a blank/synthetic sheet
  "assetId": "up_...",                           // id of the ORIGINAL upload, fetchable at /api/uploads/{id} — see docs/ARCHITECTURE.md "File uploads" — or null
  "preparedAssetId": null,                       // baked rotation+crop derivative, same /api/uploads/{id} shape; null = "use assetId as-is"
  "naturalWidth": 1700, "naturalHeight": 1300,   // pixel dimensions of the CURRENT working image (post rotation/crop)
  "prep": {
    "rotation": 0,          // 0 | 90 | 180 | 270
    "crop": null,           // {x,y,w,h} in the rotated (pre-crop) pixel space, or null
    "brightness": 100, "contrast": 100, "grayscale": 0,   // CSS-filter percentages
    "opacity": 100
  },
  "calibration": {
    "unit": "ft-in",        // "ft-in" | "ft" | "in" | "m" | "cm" | "mm" — display only
    "pixelsPerUnit": 2.01,  // pixels PER INCH, always — see units.js. null until calibrated
    "points": [{ "x":.., "y":.. }, { "x":.., "y":.. }],  // the two calibration points, or null
    "realLength": 120       // the entered real length, in inches, or null
  },
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "layers": [ { "id": "walls", "name": "Walls", "color": "#8b93a1", "visible": true, "locked": false }, /* … */ ],
  "geometry": [ /* Element, see below */ ]
}
```

Default layers (see `LAYER_DEFS` in `plan-schema.js`): `walls`, `doors`,
`windows`, `stairs`, `fixtures`, `dimensions`, `text`, `rooms`, and the
pseudo-layer `source` (controls the raster's visibility; its opacity is
`sheet.prep.opacity`, shared with the Prepare step's slider — one value, two
controls).

## Element

```jsonc
{
  "id": "el_...",
  "type": "wall",                         // wall | door | window | stair | fixture | dimension | text | room
  "layerId": "walls",
  "geometry": { /* type-specific, world coordinates — see below */ },
  "confidence": 0.87,                     // 0..1
  "status": "proposed",                   // proposed | verified | corrected | rejected
  "provider": { "id": "demo-trace-v1", "label": "Demo Trace Provider (deterministic)" },
  "sourceRegion": null,                   // {x,y,w,h} the provider traced from, or null
  "findings": [ { "id": "finding_...", "severity": "warning", "message": "...", "code": "wall-junction" } ]
}
```

All geometry coordinates are in the sheet's **world space** — the same
pixel grid as `naturalWidth`/`naturalHeight` and the raster image — never
screen pixels. This is what lets the raster and the SVG overlay share one
transform (see `docs/ARCHITECTURE.md` → "Rendering").

### Geometry by type

| Type | Fields |
|---|---|
| `wall` | `x1,y1,x2,y2,thickness` |
| `door` | `x1,y1,x2,y2` (opening endpoints), `swing: 'left'\|'right'`, `hinge: 'start'\|'end'` |
| `window` | `x1,y1,x2,y2` |
| `stair` | `x,y,w,h,steps,rotation,direction: 'up'\|'down'` |
| `fixture` | `x,y,w,h,rotation,kind,shape: 'rect'\|'circle'` |
| `dimension` | `x1,y1,x2,y2,offset` (perpendicular distance of the dimension line from the base line), `label` (override string, or null to auto-format from calibration) |
| `text` | `x,y,rotation,size,content` |
| `room` | `x,y` (label anchor), `label`, `points` (optional polygon, `[]` if none) |

## Units

`calibration.pixelsPerUnit` is always **pixels per inch**, regardless of
`calibration.unit` (the *display* unit). This is a deliberate normalization
in `plan/units.js`: switching the display unit from, say, `ft-in` to `m`
never requires reinterpreting an already-computed scale factor, because the
stored scale was never in the display unit to begin with. `formatInches()`
converts to the display unit only at render time.

## Compatibility

`SCHEMA_VERSION` (currently `1`) is written as `version` at the document
root. A future version bump would add a migration step ahead of
`normalizeDocument()`; there isn't one yet because there's only ever been
one version.
