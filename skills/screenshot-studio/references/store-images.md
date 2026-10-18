# Store images

Call `catalog` for current sizes and `storeImages` workflow, then `read_project` for the latest document, revisions and active `projectSession`.

For Apple artwork, follow `catalog.assetGuidance` and [the App Store review procedure](apple-assets.md). Header and search creatives have distinct purposes from app-in-use screenshots. Inspect template safe areas across placements before publishing.

Use `add_store_images` rather than cloning screenshot slides into store artwork:

```json
{
  "store": "app-store",
  "sizes": {"app-store-search": [1920, 1280], "app-store-header": [3840, 1646]},
  "revision": "<read_project.revisions.studio>",
  "projectSession": "<read_project.projectSession>"
}
```

`store: "app-store"` creates two images: Search result image and Header image. `store: "google-play"` creates one 1024 × 500 Feature graphic. Optional `sizes` must match `catalog.targets[target].formats`; omitted sizes use the first preset. `afterSlide` optionally inserts after an existing slide. In standalone mode include `project`; omit `projectSession`.

The result's `images` array contains `{deviceId, slideId}` pairs, and `revision` acknowledges the save. Repeated additions keep existing images, artwork and sizes. Reread the project before editing. Each returned slide has `canvasIds` identifying its canvases; those devices have `screenScope: "store-image"`. Preserve these output assignments. Store artwork and screenshots appear together in the Editor screen list, Translate review and Overview; selecting a screen chooses its compatible canvas automatically. A combined export includes all requested screens once per compatible canvas.

Import supplied or generated artwork using `import_media` with `kind: "art"`. Compose editable art, text and shape layers in `slide.layouts[deviceId]`; coordinates use `device.designSize` or `device.size`. Save localized text with `save_copy` and retain its draft review status. Google recommends avoiding device imagery in feature graphics; use artwork that communicates the app's experience.

Export a draft restricted to the returned `devices` and `slides`, inspect the images with `read_image`, then export final when preflight passes. RGB PNGs have exact canvas dimensions and no alpha. Selecting all screens still exports only valid canvas/screen pairs.

## App Store Connect

Search and header exports are supported by the Mac app's **Upload** view and Export dialog. Select the saved export, app, editable iOS version and languages. The review displays separate Search result image and Header image destinations. Apple's runtime catalog determines availability, accepted dimensions and limits; a missing destination must be resolved before upload.

The upload reserves images under `CREATIVE_ASSETS` and places them as `APP_STORE_SEARCH_RESULTS_ASSET` or `PRODUCT_PAGE_HEADER_ASSET`. Normal screenshot destinations remain separate, even when group IDs or dimensions coincide. Google Play feature graphics are filtered out of App Store Connect uploads.

The MCP prepares and exports the artwork. To upload, direct the user to the app's reviewed Upload flow; publication or submission for review is a separate action. Report simulated verification separately from any real Apple upload or processing result.
