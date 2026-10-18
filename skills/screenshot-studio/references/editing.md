# Editable projects

`read_project` returns `studio`, `copy`, `revisions`, `captures`, `assets` and `frames`. Save only `studio` to `save_document`, not the whole bundle. Use `revisions.studio` for document edits and `revisions["copy:<locale>"]` for copy edits. Each successful save returns the new revision.

## Compose a sequence

Clone the first starter slide for each new screen, assigning a unique `id`, `name` and `capture`. Keep its `theme` and editable `layouts`. For a new screenshot sequence, retain the other screens in the document and insert the intended sequence beside them. `slide.canvasIds` restricts store artwork to its own canvases; a canvas with `screenScope: "store-image"` contains only its assigned screens. Preserve these assignments when editing and use `add_store_images` to create store artwork. Existing documents can contain shared canvases, slide order per language and locale layouts; preserve those when editing a single screen.

Copy is a locale object keyed by slide ID, with named text fields:

```json
{
  "overview": { "headline": "Your day,\nat a glance", "caption": "Everything you need in one place." },
  "progress": { "headline": "See how far you’ve come", "caption": "Small steps add up." }
}
```

The save tool sets `_meta` to draft automatically. A deliberate `\n` breaks the headline. A text layer's `field` resolves from this copy object; custom text fields work the same way.

## Custom layouts

Each `studio.devices[id]` is an output canvas, with exact export pixels in `size`. Coordinates use `designSize` when present, otherwise `size`. Displayed hardware is separate from output canvas geometry. Inspect the starter layers and `catalog` before selecting dimensions.

Each slide's `layouts[deviceId]` can use `{ "template": "custom", "panorama": false, "layers": [...] }`. Keep layer IDs unique. A useful composition keeps the real capture and all copy independently editable:

```json
[
  { "id": "hero", "type": "device", "cx": 660, "top": 740, "w": 800 },
  { "id": "title", "type": "text", "field": "headline", "x": 92, "capTop": 160, "w": 1136, "boxHeight": 490, "size": 138, "minSize": 76, "maxLines": 3, "weight": 750, "align": "center", "anchor": "top" },
  { "id": "illustration", "type": "art", "src": "<import_media result.file>", "cx": 660, "cy": 2500, "w": 700, "h": 350 }
]
```

This example uses a 1320-pixel design width; adapt to the actual canvas. Layer order controls stacking. Device layers inherit `slide.capture` unless they specify their own `capture`; `captureSet` and `profile` select separate capture collections and hardware. Art uses filenames returned by `import_media`, not external URLs. Use imported images under their applicable rights. The iPhone Duo illustration is a stand-in.

For more layout capabilities, inspect the repository's pure layout and edit modules (`app/js/layouts.js`, `layer-ops.js`, `project-ops.js`). Save plain document data; fields beginning with `_` belong to the renderer and are rejected. Make layout edits in the source project; exports are generated artifacts.

## Continuous series

`studio.sharedCanvas[deviceId].layers` holds artwork in row coordinates. Each canvas has its own row; adapt the composition to iPad and each Duo posture. The next screen starts after the previous screen width plus `sharedCanvas[deviceId].gap × device.designSize[0]` (the default gap is 0.06). The renderer omits that gap from the exported tiles, so artwork should continue across the implied store spacing. Respect language-specific `slideOrders` and per-screen orientation.

Use `edit_layers` with `shared: true` and the canvas ID to add or patch these layers. Use the raw shared layer ID from `read_project.editing[*].sharedLayers`. Shared edits apply across locales; provide `layer.localeId` when adding locale-specific shared artwork. Use `slide` and optional `locale` for local layers. For example:

```json
{
  "revision": "<current studio revision>",
  "projectSession": "<current session>",
  "edits": [
    {"op": "patch", "device": "ipad", "slide": "progress", "id": "title", "patch": {"size": 110}},
    {"op": "patch", "device": "iphone", "shared": true, "id": "background", "patch": {"opacity": 0.25}}
  ]
}
```

The batch preserves other canvases, copy and locale variants. A failed edit or stale revision saves nothing. Read the returned revision for the next edit. A layer’s `null` property clears its local value using the editor’s normal override semantics. Shared artwork belongs behind the foreground layers through its `z`; inspect existing stacking before choosing a value.
