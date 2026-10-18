# Screenshot Studio · PALUSA

The app follows [PALUSA graphic profile 3.0](https://palusa.se/profile/),
17 October 2026. The application guidance and supplied design brief define the
product treatment: a calm workspace, system typography, familiar rounded Mac
controls, and a small amount of signature colour.

Screenshot Studio uses **Korall #E62044**, its assigned product colour, for
primary actions and selection edges. White button text has a 4.51:1 contrast
ratio; hover uses Korall 700 #AF1733. Small accented text uses #AF1733 in light
mode and #F7B0BD in dark mode. The five-square **Ram** glyph comes directly from
the supplied glyph sheet, with its positions, proportions and colours intact.
It is monochrome white on dark surfaces. The original app/Dock icon is retained,
as specified in the profile.

Light appearance uses Papper #F7F5F2, white panels, Sand #EEEAE3 and Bläck
#272330. Dark appearance uses Kol #121019, Natt #1C1924, raised #2E2A38,
Papper text and secondary #A9A3B4. Input outlines, status colours and focus
rings have distinct semantic roles. The magenta-to-sky gradient is confined to
a two-pixel edge seam; there are no gradient fields behind content.

**System, Light and Dark** are available in the workspace and Welcome screen,
and in the Mac app's View → Appearance menu. The preference belongs to the app,
not a project. Mac preferences are saved outside documents, synchronize all app
windows, and update native controls. Browser development mode keeps the choice
in local storage. System appearance follows OS changes. Changing appearance
updates the existing DOM, preserving focus, scroll, open controls and artwork.

Tokens live in `app/css/appearance.css`. The early `app/js/appearance.js` script
applies the saved choice before painting. The native controller is
`desktop/appearance.mjs`. Document palettes and exported PNGs remain controlled
entirely by each document.

The supplied PALUSA logo appears directly on Welcome and About. Light surfaces
use the original full-colour artwork; dark surfaces use the supplied white
monochrome version. The logo is not placed on a decorative plate.

## Sources

- [Design brief 3.0](https://palusa.se/profile/downloads/palusa-designbrief.md)
- [Colour roles and app guidance](https://palusa.se/profile/#digital)
- [Steget and product glyphs](https://palusa.se/profile/#symbol)

## App icon

The source artwork remains `app/icons/screenshot-studio.png`.
`node tools/build-icon.mjs` creates its macOS sizes and
`distribution/ScreenshotStudio.icns`. This branding update does not regenerate
that artwork.

Both `.sss` and legacy `.screenshotstudio` packages reference this bundled icon
in the document type and exported UTI declarations, in both Xcode and Electron
packaging. Packaging verifies those references and the actual icon resource.
