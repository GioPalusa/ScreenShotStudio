# Screenshot Studio user guide

## Get started

The app reopens the last-used project if it is still available. On first launch, or if that project is missing, it shows the welcome screen. Name your project, choose an App Store or Google Play destination, and select Midnight, Porcelain, Mint or Orchid — or choose your own background, text and accent colours. **Create project…** lets you choose where to save a portable `.sss` document. Choose **Replace** to create a fresh project over an existing one; the previous project is retained under **File → Restore Version…**. Cancelling leaves the welcome screen open. **New Project** brings the palette setup back; recent documents are available on the welcome screen. Opening a `.sss` file directly opens its editor.

1. **Choose your canvas.** Setup → Canvases offers store formats. Choose one size for the row, then choose **Portrait** or **Landscape** per screenshot in Overview or the editor toolbar. This swaps width and height for that screenshot in every language, without adding another canvas or rotating its devices. The export keeps one ordered row with each image’s actual dimensions. Custom format is for your own dimensions.
2. **Bring in screenshots.** New Apple projects start with a neutral **Generic frame**. For Apple hardware artwork, open **Setup → Frames**: **1. Download from Apple**, then **2. Drop your DMG here**. Upload in Media or drop an image onto the device. Select a device on the canvas to edit its **Details**: choose its screenshot, frame and fitting. The frame dropdown offers **No frame**, **Generic frame**, then matching frames, with **Get more frames** last. Use **Browse all frames…** to choose another device style. To create an Android or another Apple canvas, open **Setup → Canvases → ＋ Store format**.
3. **Design.** Select text, an image or a shape to edit its **Details** directly; move, resize and rotate layers on the canvas. **＋ Add screens** creates new screens. **Design → Load design…** changes the current screen, and **Save this design…** saves a reusable layout. **All designs** shows complete designs, device arrangements and connected series together. Filter by one screen or a set of 2–5 screens. Adjust **Gap** in the strip preview to allow for the space between store images; this is a design estimate, since the store controls its actual spacing. Choose screenshots in order, or use **Create screens from screenshots…** after importing several screenshots in Media. Split layers stay linked across the series; **Unique design** opts a slide out. Design contains reusable palettes.
4. **Translate.** Select a screenshot from the horizontal thumbnail row to edit its text in every language underneath. Scroll sideways or use Left/Right, Home and End to navigate. Switch between **Per screen** and **Per language**. Your editable text comes first; expand **Original** for a reference or use **Show original text** to compare all fields. Meaning checks show a short status with expandable details. The main Translate action defaults to **All screens**; a screen’s **More → Translate** action targets that screen. Add languages, mark text for review, and export/import review CSVs using stable screen and layer IDs. Project actions are in the native **File** menu.
5. **Export.** Checks run automatically when the export dialog opens and whenever you change the selected languages, canvases or slides. **All screens** is checked by default. Uncheck it to choose individual languages, sizes and screens. Issues appear before any images are written; expand **Export details** for storage information and additional controls. Fix the issues or choose **Export anyway** to include placeholders for missing images and keep all issues in the export report. RGB PNGs and an upload guide go into a dated folder, with format-first numbered filenames. CLI `--strict` still requires all checks to pass.

**Text fit:** Details checks the selected text object and explains whether it exceeds **Max lines**, the box width or the box height. Text can fit visibly inside its box while exceeding its configured line limit. If that is the only issue, **Allow 3 lines** (or the reported count) updates that object's line limit; ⌘Z undoes it. Set **Max lines** to **0** for unlimited lines; width and height still have to fit. The same explanation appears in export checks. **Typography → Text size → Fill frame** fits text to the box and ignores the manual line limit while preserving explicit line breaks.

**Overview** shows one scrollable row per language at the same preview size. Use the zoom slider or a custom percentage (10–200%), or **Fit to width** to fit the entire row as the window changes. Horizontal scroll and arrow buttons reveal the rest of a wide row; zoom is remembered on this Mac.

**Edit all screens:** the first button in the editor’s screen list opens the whole row as a shared canvas. Its screen count shows the scope. Right-click any screen thumbnail to duplicate or remove that screen, including while All screens is active. Copies keep every language and appear directly after the source in each language’s order. Removal asks for confirmation and can be undone. Objects added here can overlap multiple screens; editing one of these objects from an individual screen updates the same object everywhere. Images and other objects added on an individual screen remain local, even when they extend outside its edges. In All screens, object choices are grouped by numbered screen name, with a separate Across screens group for shared objects. Moving or resizing an existing object makes it shared by default. Screen edges stays available in both views; an explicit Keep on this screen choice is saved and respected even when moving the object in All screens. In a single-screen view, Details → Screen edges chooses Keep on this screen (crop at its edges) or Continue across screens (one linked object). ⌘C and ⌘V copy and paste selected objects, including independent text in every language; pasting in All screens creates shared objects, while pasting in a single screen creates local objects. Each canvas format has its own shared objects, while language-specific images and text remain supported. Design → Space between screens offers App Store, Google Play and Custom spacing. Every distance is shown in pixels at the exported screenshot size; Custom accepts a precise pixel value, including zero and decimals. New canvases default to their store; existing spacing is preserved. These are Studio preview presets, not fixed store specifications. Exports crop each screen and omit the gap. Pinch to zoom or press **0** to fit the row.

**Trackpad navigation:** pinch to zoom around the pointer in the editor and Overview. Scroll with two fingers to pan in either direction; small movements and momentum stay continuous. In the editor, press **0** to recenter and fit the canvas, or **− / +** to zoom from its current size. A mouse wheel pans too; hold **Control** to zoom or **Shift** to pan horizontally. Middle-button dragging also pans the editor. Navigation changes only your view, not the exported design.

**Help → Get Started Guide** is always available. **View → Keyboard Shortcuts** lists editing shortcuts. ⌘Z / ⇧⌘Z undo and redo. Autosave uses atomic writes, conflict checks and recoverable drafts. Save Version and Recover Automatic Backup open separate recovered documents.

Apple bezel artwork is not bundled with the app. Setup → Frames has two prominent steps: **1. Download from Apple** opens Apple Design Resources; **2. Drop your DMG here** accepts the downloaded disk image (or use **Choose DMG…**). macOS presents any agreement included in the image; accept it there to continue, or decline to cancel. PNGs from its folders appear in a preview where you select the frames to install in the app’s shared library. They become available in every project on this Mac. Frames used by a design are also retained inside its .sss package so it stays portable. Photoshop files are ignored. Studio waits for the mounted volume even if Finder opens or macOS publishes the disk late. Images mounted by Studio are ejected after reading; already mounted images are left in place. **Import PNGs…** remains available for individual files. Imported frames and artwork already stored in existing projects stay intact. Generic Studio illustrations remain available. Duo illustrations are no longer offered; existing projects retain their saved frame choices. New documents contain no app screenshots or imported artwork. Existing `.screenshotstudio` documents remain compatible. User projects and the historical local fixture in `project/` are excluded from public source and every packaged build. Tests use synthetic documents.

## Export screenshots

In the Mac app, choose **Export…**, review the selected images and checks, then start the export. A native folder picker opens every time. Choose a folder outside the project package; an additional copy is saved in its own dated subfolder with PNGs, a manifest and upload guide. The same completed run is retained in the project’s export/ folder and is listed under Saved exports in Export and Upload after reopening. Save As includes captures, artwork and completed exports. Cancelling the folder picker returns to the export options without writing export files. **Show in Finder** reveals the completed export. Browser development mode and CLI exports use their configured output directory.

## Translation and importing designs

**Translate…** in Translate or text Details accepts an OpenAI or Claude API key for the current dialog. Choose the target language and screens. **Translation options** contains the original language and whether to fill missing text or replace it. Provider, model and API key settings expand when setup is needed. Results update that language, remain draft for review, and can be undone.

**Overview → Import designs…** (also in Media) accepts PNG/JPEG exports, folders and ZIPs from other screenshot tools. Images remain image layers; fastlane Framefile sources also import editable text and generic devices. Preview the language mapping before adding slides. [Supported formats, limits and research](imports-and-translation.md).

## Development

This is an open-source community project under the [MIT license](../LICENSE). See [CONTRIBUTING.md](../CONTRIBUTING.md) to get involved and [SECURITY.md](../SECURITY.md) to report vulnerabilities. Use Node 22.12 or newer (Node 24 recommended):

```sh
npm ci
npm test
npm run desktop
npm run package
```

The default CLI/browser project is the neutral `starter/` document. Supply `--project /path/to/Your.sss` for another document. `npm run test:render` runs real render/export regression checks. The plain JavaScript core has no Electron dependency; local files and desktop lifecycle live in `host/` and `desktop/`.

## Apple distribution

Open **Screenshot Studio.xcodeproj**, choose **Screenshot Studio → My Mac**, and **Product → Archive**. Xcode packages Electron for Apple silicon (arm64), signs its nested code with Developer ID and Hardened Runtime, then seals the app. End users do not need Node. Official releases use the maintainer’s Developer ID team. Set your own signing team for a fork.

In Organizer choose **Distribute App → Direct Distribution**, wait for Apple acceptance, then **Export Notarized App**. Each changed build needs a new archive and notarization; `npm run package` is an ad-hoc developer build. No credentials are stored here. Versioned verification records live in `distribution/RELEASES.md`.

```sh
codesign --verify --deep --strict "/path/to/Screenshot Studio.app"
xcrun stapler validate "/path/to/Screenshot Studio.app"
spctl --assess --type execute --verbose=2 "/path/to/Screenshot Studio.app"
```

[Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) · [Electron code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)

### Design gallery

In **＋ Add screens**, all 44 designs are visible: eight complete designs, 30 device arrangements and six connected series. To change an existing screen, use **Design → Load design…**. This opens the same chooser with complete designs, device arrangements, basic layouts and your saved designs; it does not add screens. **Save this design…** saves layers and positions for reuse within the project. Text, screenshots and screen colours stay with each screen. Manage saved designs in **Setup → Saved designs**. Choose Pulse, Paper, Citrus, Bloom, Nocturne, Blueprint, Atelier or Terracotta for **1–5 screens**. **With text** includes editable headings and captions; **Without text** keeps the artwork and rebalances the devices without adding sample copy. **1 screen** offers styled designs with a single device as well as device-only layouts. Connected series span 2–5 images, with an adjustable preview gap. Original colours are selected by default; expand **Colours & device** to customise them. Multi-file imports open the same gallery with the imported count and screenshot order. Example screens are only previews; missing captures still block final export. Sample English copy is saved as draft in every language and needs review. Creating a design, including its text, is one Undo step.

## Automatic updates

Official Developer ID builds check GitHub Releases through Electron’s native updater. Use **Screenshot Studio → Check for Updates…**, or disable automatic checks in the same menu. Installation waits for project saves. Development and ad-hoc builds do not update automatically. [Release and update instructions](releases.md) explain signing, notarization, ZIP naming and publishing.

## License and assets

Original source and SVG interface icons use MIT. Dependencies retain their own licenses; see [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). Apple artwork and private screenshots are not included. PALUSA names and logos remain trademarks.

### Upload to App Store Connect

Choose **Upload to App Store Connect…** after export, or select a project run under **Upload → Saved exports**. Small previews show the exported artwork in one language, with the newest export selected. Click a card or use the arrow keys to choose a set; older exports are available under **Show older exports**. Use **Choose export folder…** to upload a saved export later without exporting again. Choosing an older external export while a project is open also stores a validated copy in that project. You can also start from **Upload screenshots…** on Welcome or the File menu. The Export → Destination → Review → Upload steps share a visual inventory: every main screen appears once, alongside the language, size and actual image totals. Translated versions are included in the total instead of repeating the preview grid. Connect an API key, choose the app and editable version, review the images and destinations, then upload. Review counts only images that will be sent; existing groups that will be kept are called out separately. Expand screen selection, Apple sizes or upload destinations when you need more control. Text, layout and translation-review warnings can be accepted with **Upload anyway**; technical errors still block upload. Existing language and screen groups are kept while missing groups upload across every exported language; replacement is explicit. Duo open and closed share one screenshot selection and limit. See [App Store Connect setup and upload guide](app-store-connect.md) for account setup, limits, stopping and reports.


## MCP and skill help

Open **Guide & MCP** from the toolbar or **Help → MCP and Skills Guide**. Its pages cover the editing workflow, the local stdio MCP connection, installing the companion skill, and example requests. Choose Codex or Claude Code, then use Install skill and Set up MCP. The connection uses the project open in the app, saves pending editor changes before tools run, and follows project switches automatically. The setup view shows the active project; no separate workspace picker is needed. If you previously installed a fixed-workspace connection, choose Update MCP connection once. The app bundles the server and renderer: no separate Node, Chrome or source checkout is required. Test MCP checks the local server; reload your AI client to load the new skill and connection. Existing settings are preserved and changes get backups.

## App Store search and header images

In **＋ Add screens → Store images**, choose **App Store** to create a **Search result image** and a **Header image** together, or **Google Play** for one **1024 × 500 px Feature graphic**. Choose each canvas size before adding it. All store images and screenshots appear together in the left screen list. Select any screen to use its canvas automatically; your selected screenshot format is remembered when returning to screenshots. Translate → Per language reviews the whole project together, and Overview includes all screens. Store artwork stays at the top of the sidebar. Use **Screenshot canvas** in the sidebar to choose another screenshot output format; **Edit canvas screens** always opens the phone screenshot row. Add text, shapes and imported artwork in Editor or Media. Each image has its own screen, translations and canvas dimensions within the same workspace. A combined export/upload includes screenshots and store artwork together, while output filtering keeps each image on its assigned canvas and avoids duplicate assets. Adding the set is one Undo step. Adding it again opens the existing images without replacing their artwork.

In **Setup → Canvases → Add a store format**, you can also add individual formats. Choose **Search result image** (5244 × 2950, 3840 × 2560 or 1920 × 1280 px) or **Header image** (5244 × 2950 or 3840 × 1646 px). These are editable landscape canvases independent of the devices displayed in the design. Select one slide per placement and language at export. Exported PNGs remain RGB without alpha.

Upload uses Apple’s creative asset library category and the corresponding search-result or product-page-header placement, with Apple’s runtime catalog determining accepted specs and group limits. Review the app, editable iOS version, language and destination before starting. Uploading does not submit for review. See [Apple’s creative asset specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications/) and [placement API guide](https://developer.apple.com/documentation/appstoreconnectapi/placing-assets-on-your-app-store-surfaces).

### App appearance

Choose **System**, **Light** or **Dark** in the appearance control in the toolbar
or on Welcome. The Mac app also has **View → Appearance**. System follows your
Mac's appearance; an explicit choice stays in effect until you change it.
The preference is shared across app windows and remembered between launches.
It changes the workspace colours, while your screenshot artwork keeps its own
palette and exports the same way in either appearance.
