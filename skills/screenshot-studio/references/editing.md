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
