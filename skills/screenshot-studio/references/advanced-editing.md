# Native objects and design imports

Call `catalog` and `read_project` first. Reuse the current `projectSession` in active-app mode. `inspect_layers` takes `device` plus `slide` and optional `locale`, or `device` plus `shared: true`. It returns `editScope`, the current studio revision, clean resolved layer data, text fallback, stacking, groups, masks, paints and live corner keys. Use `vectors: true` for original path anchors, handles and segment command indices. Match every edit to that scope. Imported Figma screens often live in an independent locale layout, including the source language; pass its `locale` explicitly.

`preview_project` with `details: true` returns the image plus `scenes`: actual measured layer bounds, text lines, fitted font size, overflow and capture resolution. `revisions.studio` identifies the frozen source used for measurement. Bounds are unrotated design boxes with a centre rotation in degrees; affine `basis` and masks remain in the native layer data. Shared layers have raw IDs, screen-projected bounds and a `rowOffset`; add that offset to a measured screen x position before writing shared row coordinates.

## Atomic native edits

`edit_layers` accepts 1–200 operations in order and saves once. A bad operation or stale studio revision saves none of the batch. Use `id` for one patch/remove/vector, and `ids` for selections. Every operation also carries `device`, `slide` and optional `locale`, or `device` and `shared: true`. Advanced operations reject locked layers; a deliberate patch can unlock one first. A patch replaces each named property; use paint/shadow operations to preserve sibling settings within those objects.

| `op` | Fields and behavior |
| --- | --- |
| `add`, `patch`, `remove` | `layer`, or `id` plus `patch`, or `id`; text, device, art, shape and route remain native. |
| `group` | `ids`, optional new `group` name. Keeps geometry. |
| `ungroup` | `ids`; releases all members of the selected groups. Release masks first. |
| `reorder` | `ids`, `direction`: `forward`, `backward`, `front`, `back`. Retains selection order. |
| `appearance` | `ids`, `source` layer ID in the same scope, or `appearance`. Copies appearance without geometry, text content or capture identity. |
| `shadow` | `ids`, optional `preset`, `distance`, `angle`, `shadow: {color, alpha, blur, dx, dy}`, or `enabled: false`. |
| `paint` | `ids`, `action`; see fills below. |
| `corners` | `ids`, `radius`, optional `corner` key; omitted key applies to all live corners. Rectangle and closed polygon corners clamp to their geometric limits. |
| `vector` | `id`, `action`, optional `path` index (default 0); see paths below. |
| `mask` | `ids`, optional `mask` layer ID; defaults to frontmost selected object. |
| `unmask` | `ids`; releases every member of each selected mask, restoring prior groups and compositing. |
| `boolean` | `ids`, `operation`: `unite`, `subtract`, `intersect`, `exclude`, optional new `resultId`. Replaces selected closed shapes with an editable path. Subtract removes front shapes from the backmost. |

Shadow presets come from `catalog.editing.shadows.presets`, including `subtle`, `soft`, `floating`, `crisp`, `dramatic`, `lifted`, `left`, `long` and `glow`. Angles increase clockwise from the right: 0° right, 90° down, 180° left, 270° up. Distances and blur use design pixels; alpha uses 0–1. Changing only angle/distance preserves the current colour, opacity and blur. Removing a shadow retains its settings for restoration.

```json
{
  "revision": "<current studio revision>",
  "projectSession": "<current active session>",
  "edits": [
    {"op":"shadow","device":"iphone","slide":"overview","ids":["hero"],"preset":"soft","distance":28,"angle":110},
    {"op":"corners","device":"iphone","slide":"overview","ids":["card"],"radius":24},
    {"op":"appearance","device":"iphone","slide":"overview","ids":["secondary-card"],"source":"card"}
  ]
}
```

Use `arrange_layers` for `left`, `right`, `top`, `bottom`, `center-x`, `center-y`, `distribute-x` or `distribute-y`. It measures the selected screen through the real renderer and saves only if the studio revision still matches. One layer aligns to the oriented canvas. Multiple layers align within their collective bounds; distribution requires at least three. Supply local IDs, `device`, `slide` and the intended `locale`. Hidden objects and missing assets with no measurable bounds need attention first.

## Fills and vector paths

Use `paint` with `action: color`, `color` and optional `target: fill|stroke` for a common solid edit. `none` saves the current paint for `restore`. `swap` exchanges a single solid shape fill and outline. `width` takes the displayed outline width in design pixels and converts it to native path units.

For individual fills, `index` selects a paint (default 0). `type` takes `paintType: solid|linear|radial`. `patch` takes a `paint` patch; `add` appends a `paint`, and `remove` deletes one paint. `stop` takes a stop index plus any of `color`, `opacity` and `position` (0–1); it preserves other stops and fills. `angle` rotates gradient handles without discarding the stops. Text supports one fill; shapes support multiple fills. Image paint `src` is a document asset filename returned by import, with its transform retained.

Native paths have `paths[*].d`, `pathSize`, `pathOffset` and sometimes `basis`, flips or rotation. `inspect_layers(vectors=true)` exposes the original command indices and control points. Use `vector` actions:

- `move_anchor`: `command`, `point: [x,y]`.
- `move_handle`: `command`, handle `offset`, `point`, optional `linked` (default true).
- `split`: segment `command`, optional `t` (default 0.5).
- `delete_anchor`, `corner`, `smooth`: anchor `command`.
- `bend`: segment `command`, `delta: [dx,dy]`, optional `t`.
- `replace`: valid SVG path commands in `d` for that path index.

These points use the original path coordinate system, not the screenshot canvas. Operations reframe bounds and preserve affine transforms and paint placement. Point edits reset the old live-corner source; inspect again before a second corner edit.

## Canvases, ordering and templates

`edit_project` accepts 1–100 structural operations and saves once with the studio revision:

- `add_canvas` with `canvas: {label, size, layout, target?, capture?, frame?, reuseFrom?}`; returns the generated canvas ID. `layout` is `phone`, `tablet`, `wide` or `outer`; `size` is export pixels. `resize_canvas` takes `device`, `size`, `mode: scale|keep`. `remove_canvas` keeps at least one canvas and removes its exclusive store screens.
- `orient_canvas` with `device`, `slide`, `orientation: portrait|landscape`. This changes that screen's orientation, subject to its store format.
- `rename_slide` with `slide`, `name`. `reorder_slide` with `slide`, `relativeTo`, optional `after` (default true), `locale` and `allLanguages` (default false).
- `independent_layout` with `device`, `slide`, optional `locale`, `independent: true|false`. Freezing keeps visible layers and localized text editable; reconnecting restores the linked layout.
- `shared_spacing` with `device`, `preset: app-store|google-play|custom`, and `gap` for custom (ratio of design width, 0–1).
- `save_template` with `slide`, `name`; returns `template`. `apply_template` with `slide`, `template`, optional `devices`. `detach_template` with `slide`. Independent layouts retain their own composition.

For other document structures use `save_document` with the current revision. Canvas IDs identify outputs; hardware `profile` and `captureSet` identify the displayed device and capture collection independently. `read_project.hardware` lists available profiles, including project-specific frames. Preserve store screen assignments, other locale layouts and existing media.

## Figma and portable fonts

Use `prepare_design_import` with `action: inspect` and one `url` or local `source` file. `format` is `figma-json` (REST file/nodes/frame JSON) or `figma-clipboard` (saved clipboard HTML). URLs use the app's saved Keychain connection; standalone servers may read `FIGMA_ACCESS_TOKEN` from their environment. Keep credentials outside tool arguments and project files. In active-app mode local files belong inside the document or adjacent `inputs/` directory.

Inspect returns frame IDs and version. Prepare one frame with `action: prepare`, `ids: [frameId]`, `device`, `slide`, optional `locale`, and the current studio `revision`; pass `version` to pin a remote selection. For offline JSON with image fills, supply `images: {"<Figma image reference>": "<local image path>"}`.

Preparation imports image assets and returns collision-safe `edits`, complete destination locale `copy`, `copyRevision`, `revision`, warnings and font families. The layout and copy are still unchanged. Use this sequence:

1. Review warnings, target scope and fonts with `font_catalog`.
2. Embed licensed missing fonts using `import_fonts`: `sources` for local `.ttf`/`.otf` paths, or `families` for official Google Fonts. It returns actual families, styles, weights, new revision and unresolved families. Font files and downloaded licenses travel with the document. An import that changes the studio revision requires preparing the design again.
3. Apply returned `edits` with `edit_layers` and its studio revision. Save returned `copy` for the destination locale with `save_copy` and `copyRevision`. Each save is separately revision-checked and acknowledged; on conflict reread and merge rather than overwriting newer text.
4. Preview the affected screen and complete series with `details: true`. Check native text, masks, image fills, gradients, orientation, font loading and fallback. Machine-written or imported copy remains draft.

For large imports over 200 layers per view, native SVG paste, or creating a new document directly from a Figma selection, use the Mac app's File import and paste workflows, then continue through MCP on the open document.
