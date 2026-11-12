# Canvas drawing tools verification

Verified on 2026-11-12 in the Xcode Debug Mac application and isolated browser fixtures.

The left workspace toolbar offers Select (V), Edit points (A), Rectangle (R), Ellipse / circle (O), Line (L), Pen / vector (P), Text (T) and Image (I). Drawing produces ordinary editable shape/path layers and uses the existing atomic save, recovery and undo system. Unfinished drawing previews are UI state and are never saved as document layers.

## Automated checks

- `tools/drawing-tools.test.mjs`: reverse-direction drags, square/circle constraints, drawing from centre, constrained lines, exact pen handles, path origin mapping, closure and transparent open paths.
- `tools/drawing-tools-ui-test.mjs`: visible tool selection, real editor pointer events, actual drawn coordinates, Shift + Option centred circles, line creation, one-step Undo/Redo, cancellation, pen clicks and handle drags, closure, open paths, draft-point Undo, visual point editor, text tool, image picker focus/cancellation, shared-canvas coordinates and persisted document equality.
- The existing visual vector editor test still passes alongside the tool panel. Both drawing checks are included in the standard test commands.

## Native usability checks

A new isolated `Verktygspanel – verifiering.sss` was created under the user's Screenshot Studio Import Tests directory. Using native mouse and keyboard input in the Mac app:

1. Selected Rectangle in the toolbar and dragged out a rectangle at the intended coordinates.
2. Switched with O and drew an ellipse with matching width/height, visible as a circle.
3. Switched with P, clicked the first point, dragged the next point's Bézier handles, added a third point and clicked the first point to close the vector.
4. Switched with A, moved a point on the new vector and undid the change.
5. Switched with V, undid creation of the vector as one step, and restored it with Redo.
6. Saved, quit and reopened the document. All three objects retained their shape and placement. Saved JSON contains a rectangle, ellipse and closed cubic path; no raster fallback.

Native drawing was exercised in All screens. Automated checks also cover an individual screen. The toolbar was visually reviewed in the existing dark appearance: consistent icon sizes, 44-pixel buttons, visible active state, shortcut labels, separated tool families and no extra cards around controls. Shape constraints with modifier keys were verified by synthetic pointer events; the native circle test used equal drag dimensions.

## Fill/stroke presets and familiar Bézier editing

The follow-up uses the familiar filled Selection arrow, outlined Direct Selection arrow, P pen, square anchors, round direction handles and Smooth/Corner conversion. Illustrator's [Pen tool](https://helpx.adobe.com/illustrator/using/tool-techniques/pen-tool.html) and [anchor conversion guidance](https://helpx.adobe.com/illustrator/desktop/draw-shapes-and-paths/modify-paths/convert-anchor-points-on-a-path.html) informed the interaction model. This does not claim complete Illustrator/Figma feature parity.

Toolbar fill/outline colours, enabled states and width are stored as UI defaults. They are applied only when adding a new shape. Open paths remain unfilled. Object resize/rotation handlers now run before drawing-tool handlers; this fixes the visible handles starting another shape instead of resizing/rotating the selected one.

Native checks used separate `Färger och handtag – verifiering.sss` and `Bézierhandtag – verifiering.sss` documents. A rectangle used the toolbar's exchanged fill/outline and 8 px width; resizing and rotating it to 90° worked while R stayed active. A straight line was bent into a cubic. On the dedicated curve, selecting the interior anchor showed two direction handles. Dragging the incoming handle rotated the opposite handle while maintaining a common tangent; disabling Link handles let the outgoing handle change without moving the incoming one. Undo restored the linked geometry and the document was saved.

Pure tests verify linked versus independent handles, bending endpoints and closure, and tight edited bounds while preserving affine path/gradient coordinates. Geometry reframing currently leaves image-filled and legacy-gradient paths' original bounds intact to preserve their paint mapping. Native imported text and vector layers are not flattened. UI regressions cover colour presets without modifying existing layers, drawing-mode resize/rotation, bending/Undo, geometry persistence and rendering after save/reopen.

## Compact icon toolbar

The toolbar was reduced from 52 px to 40 px, with 32 px buttons and 17 px icons. Inline hand-drawn tool glyphs and visible shortcut letters were replaced by bundled Lucide icon masks, alongside the existing text/photo icons. Names, shortcuts, accessible labels and active states remain available. Fill/stroke controls were narrowed to fit the rail. The drawing UI regression passed and the Xcode Debug build was visually inspected in the Mac app: all nine icons and the colour/width controls remained visible without clipping. Lucide assets include their ISC license in the application.


## Overlapping fill and outline controls

The compact rail now uses overlapping solid-fill and hollow-outline squares instead of paint checkboxes. A click selects the active paint; double-click or focused Enter opens its colour picker. No colour shows a red diagonal slash. Use colour restores the cached colour. Swap exchanges both colours and their enabled states, including None. X switches the active paint, Shift+X swaps, and / selects None. Preferences apply only to subsequent shapes.

The drawing UI regression passed with assertions for None on either paint, cached-colour restoration, swapping disabled paints, keyboard shortcuts, and unchanged existing layers. The Xcode Debug build succeeded. Native testing in the isolated `Färgrutor – verifiering.sss` document verified the real colour-picker popup, a transparent rectangle with an 8 px outline, restored and swapped colours on a second rectangle, and a filled third rectangle with zero outline. The saved canvas and compact controls were visually reviewed in the Mac app.


## Selection-aware paints and live corners

The rail now binds to selected shapes and text fills; absent selection it retains separate drawing defaults. Mixed selections show striped fills. Gradient fills show previews and remain editable; choosing a colour changes the displayed fill to solid, preserving sibling fills. Solid fills/outlines can swap; unsupported gradient swaps are disabled. None stores the original paints in plain document JSON for lossless restoration after reopen. Selected paint edits checkpoint and save through the editor, including a single Undo step for multi-selection. Native testing changed the first shared rectangle from transparent to #50ffff using the rail colour popup and verified the changed fill on canvas and in Details.

Live corner circles appear on rectangles and closed polygon paths. V changes every corner; A changes only the dragged corner. Radii clamp to avoid overlaps; path rounding uses native circular arc commands and retains source geometry for subsequent radius adjustments. Ordinary point geometry edits clear that source to prevent obsolete corner geometry from returning. Smooth curved paths and open paths do not offer polygon corner widgets.

Automated tests cover paint binding, restore/swap/width, exact Undo, imported gradient preservation, mixed multi-selection, rectangle all/single corner drags and Undo, pure polygon arc/source preservation, and existing vector pointer/gradient/blur/reopen rendering. The Xcode Debug build passed. Native corner testing dragged all four radii from 0 to 38.6 px with V, then changed only the top-left radius to 20.6 px with A; the other three stayed at 38.6 px. Undo returned all four to 38.6 px. The visual audit confirmed distinct circular radius widgets, separate square resize handles, active arrow state and matching object/rail colours.


## Outline width slider and numeric input

The rail now offers a compact vertical outline-width slider and a numeric field; Details → Outline provides a horizontal slider next to its numeric field. Both controls synchronise, preserve native vector scale mapping, and participate in Undo. The slider covers 0–40 px initially and expands to accommodate larger numeric values, up to the existing numeric limit of 200 px.

The drawing UI regression passed for slider→number, number→slider, rail→inspector, Undo, and unchanged fills when Fill is active. Native testing caught and corrected width actions mistakenly targeting Fill; width now always targets Outline. A native drag changed the test rectangle’s outline from 8 to 21 px while its #50ffff fill stayed unchanged. Typing 12.5 set the inspector slider and numeric value to 12.5 px. The Xcode Debug build passed.


## Expand width from the numeric field

The permanent width sliders were replaced by a shared compact number field in the rail and inspector. Clicking or focusing it opens a top-layer popup containing a horizontal slider, exact number and px unit. Native popover dismissal handles outside clicks; Escape closes it without deselecting the object. Slider keyboard events stay inside the control. The popup is positioned within the window and above the scrolling rail, leaving the 40 px toolbar compact.

The drawing UI regression passed for initial collapsed state, click-to-expand, exact popup input, Escape without losing selection, both inspector and rail controls, live synchronisation and Undo. The Xcode Debug build passed. Native testing visually checked the popup beside the rail, dragged 12.5→22.5 px, typed 7.5 px in its exact field, and closed it with Escape. The selected shape and inspector reflected the changed outline while its fill remained #50ffff.


## Expandable corner and blur fields

The width control was generalised to a bounded numeric popup and reused for shape blur, common rectangle radius and the four individual corner radii. The field-specific maximum and units are preserved. Common-radius changes synchronise individual corner inputs. Automated drawing checks passed for popup opening, decimal blur, radius clamping, individual-corner edits, sync and exact Undo. Existing vector-editing save/reopen pixel checks passed. Native testing expanded Blur, dragged 0→11 px and typed 4.5 px, then expanded Corner radius, dragged to 27 px and typed 13.5 px; all individual corner fields updated. Escape closed both popups without losing selection.


## Shadows on every object type

Appearance exposes Add/Remove shadow for text, images, device frames, shapes, outline-only vectors and routes. Colour, opacity, blur, signed X and Y offsets use the same expandable exact/slider controls. Removing a shadow stores its settings for later restoration. Native testing added shadows to a rectangle and visible shared text, and changed a rectangle’s X offset to −20 px through the popup.

The dedicated shadow UI/render test passed for all six representative types, actual rendered pixel changes, identical baseline pixels after removal, retained colour/alpha/blur/XY settings, negative decimal offsets, Undo and portable save/reopen. Rendering was fixed for routes and unfilled vector strokes. The complete renderer suite, including Figma fidelity comparisons and existing export pixel checks, passed after correcting hidden numeric popups so they are exposed as dialogs only while open. The full module/unit suite passed 377 tests.

## Common appearance, spacing, masks and boolean geometry

Appearance transfer uses a versioned clipboard envelope and compatible property patches. It preserves destination content and geometry, converts outline widths through vector scale and keeps gradient paints editable. Multiple selections expose common fields with Mixed values, type-specific controls and atomic Undo. Numeric popups remain open during a live multi-object edit. Native Edit-menu accelerators and context-menu actions are included.

Measured gaps appear while dragging or Option-hovering. Equal spacing snaps between neighbours and beyond an existing pair; transformed objects use their world bounds. Masks preserve the original objects and retain their prior grouping/compositing state for Release mask. Clipboard transfer retargets mask references so duplicates remain independent, including All screens aliases.

Boolean operations use bundled MIT-licensed Paper.js curve geometry. Union, subtract, intersect and exclude return normal editable paths, retain affine geometry, remap gradient/image paint coordinates and preserve visual outline width. Empty results are rejected before a checkpoint. Inputs must be closed, unlocked, have the same owner and clipping group, and number at most 100. This is a destructive vector combine with Undo, rather than a live boolean group.

`editor-appearance.test.mjs` and `shape-operations.test.mjs` cover pure transfer, scale conversion, distances, all boolean bounds, curve preservation, affine gradients, mask restoration and copy retargeting. The corresponding real-renderer UI tests cover rendered mask/boolean pixels for all four operations, copied masks, common text and shadow changes, slider Undo, equal-gap guides, Option measurements and portable persistence.

The Xcode Debug build passed. Native testing in the isolated `Redigeringsverktyg – verifiering.sss` document verified ⌥⌘C/V transferring blue appearance to a red rectangle without moving it, Undo, Union producing a 150×100 editable path, point selection/nudging, two selected texts changing to 36 px, adding shadows to both, a blue rectangle clipped by an ellipse and restored with Release mask, and a spacing drag snapping X from 352 to 350 for equal 50 px gaps. These checks ran in All screens. The full suite passed 383 tests and the complete render/export suite passed, including existing Figma pixel comparisons and production RGB export checks.

## Focused Details and missing-font decisions

Details now shows document facts/settings/font management without a selection, and selected-object properties without the global layout banner when selected. Screen-edge controls and object actions are secondary collapsed sections. Position and Effects precede shape styling; a newly drawn rectangle exposes Add shadow before its fills and vector controls. The Layers tab remains the place to browse objects.

Figma API import and native clipboard import now review unavailable fonts before rendering previews. SVG text paste uses the same resolution dialog. A simple family/status list sits above one shared .ttf/.otf upload area and a shared replacement choice (including System font). There are no per-family buttons or selectors. Replacements are applied to actual editable layer data, so preview and persistence agree. Cancellation precedes document edits. Google font collection and project font embedding remain supported; installed fonts are recognised. Generic CSS font families have readable labels and initial font choices stay usable while the Mac font catalogue loads.

Targeted renderer tests passed for selection/context isolation, all six object types with shadows, missing-font cancellation, SVG replacement, Figma preview/import replacement, original-font upload/save, and existing Home import. Existing vector and shared-canvas tests were updated to browse the Layers tab now that empty Details describes the document. Native Xcode Debug testing in the isolated editing fixture verified document Details, a newly drawn rectangle with a visible shadow, the missing-font dialog on pasted SVG text, explicit System font replacement, subsequent text editing and persistence across application restart.

The font report retains every required family after file uploads. It identifies still-missing weights/styles, original fonts included, fonts available on the current Mac and explicit replacements. Added files show their matching requested faces or report no match. Coverage tests verify successful upload with the resolved row retained, partial coverage with resolved and missing rows together, and an unrelated uploaded font leaving confirmation blocked.

The simplified font UI passed coverage tests again, including an assertion that font rows have no controls and the dialog has only one shared replacement selector. Native testing of an unrelated Mulish file retained both requested families as Still missing and reported that the uploaded file matched no requested face.

Adobe reference refinement: the warning is a compact counted list with shared Replace fonts… / Cancel / Add fonts… actions below. Replacement controls are initially hidden and appear only on Replace fonts…. When uploaded files cover all remaining requirements, the banner and rows show resolution and Continue becomes available. No activation-service integration or per-font action is implied.

## Hierarchical context menus

Context menus support portalled submenu levels, separators, shortcuts, disabled commands, hover/click opening, arrow-key navigation, typeahead, branch-level Escape/Left, focus restoration and outside/Tab dismissal. Panels clamp to the viewport and flip left at the right edge. The object menu groups arrangement/grouping, alignment/distribution, rotation/flips, appearance/shadows and vector/mask commands; Combine shapes adds a third level. Selection-aware stack changes preserve relative order and match keyboard stacking shortcuts. Lock and visibility shortcuts apply to the selection as their menu actions do.

The isolated context-menu UI regression passed pointer and keyboard navigation, three levels, edge flipping, disabled items, separators, dismissal, focus, shadows, multi-object rotation/stacking, editable Union, Undo and unlocking. Pure stack tests cover one-step and extreme moves, stable selection order, hidden neighbours, locked selections and no-op JSON preservation. Native Xcode Debug testing verified right-clicking a drawn rectangle, Transform submenu, Return rotating to 90°, Undo, removing/restoring a shadow, preservation of a two-object selection, Vector → Combine shapes third-level commands, and Left/Escape returning through levels without changing that selection.

Validation: the full module/unit suite passed 386 tests; context-menu UI and existing shape/mask render regressions passed. The Xcode Debug build succeeded.

## Empty-canvas actions, readable measurements and polar shadows

Empty canvas and surrounding workspace areas now open Paste and nested Add menus. Text, image and native shape creation uses the pointer position; shapes retain the drawing fill/stroke defaults. Native Paste invokes trusted Electron webContents.paste without converting the clipboard to plain text, preserving editable Studio/Figma and image formats. Browser fallback reads supported clipboard MIME types. Plain clipboard text becomes a native text layer with draft copy metadata and atomic Undo.

Distance labels explicitly reset the preview's inherited zero line-height, use opaque dark backgrounds with white text, and have full-height padded boxes. Measurements use 2 px lines and ticks with a light halo. Coordinate readouts move below the selection while measurements are shown. Renderer UI assertions check line height, badge dimensions, text/background colours, geometry, snapping and unchanged saved source.

Shadow settings add editable presets, distance, an accessible pointer/keyboard angle dial and exact angle fields. Cartesian offsets remain under Advanced and synchronise with polar edits. Zero-distance shadows retain their chosen angle. Pure tests verify geometry, source preservation and independent preset copies. UI tests exercise every representative object type, distance/angle/XY sync, pointer and keyboard dial changes, preset identification and atomic Undo; multiple selections offer presets and polar fields too. Existing shadow pixel removal/reopen checks, drawing tools, Details, Figma import/paste and common appearance regressions pass.

Native Mac testing created an ellipse via Add → Shapes at the clicked location, copied it and used empty-canvas Paste to create an editable duplicate, applied Soft (20% opacity, 12 px distance, 32 px blur), dragged the angle dial, used keyboard increments to reach 10° and entered an exact 40 px distance. These checks used the isolated editing fixture. The Xcode Debug build succeeded and the full module/unit suite passed 389 tests.
