# Screenshot Studio · PALUSA

The application chrome follows PALUSA's graphic profile 2.1 (11 October 2026).
The source manual is `Documents/Design & Presentations/Grafisk profil/index.html`.

Light surfaces use Sand #EEEAE3, white cards, Bläck #272330 and secondary text
#6D6576. Primary actions use Magenta #C0338B with white text and #8A2464 on
hover. A small Magenta–Himmel band identifies the workspace. Large headings
use Helvetica Neue; compact controls retain the Mac system font.

Dark surfaces use Midnatt #101C36, raised #16264A, Is #F3F8FA, secondary
#A3B2CC and Himmel #B1DFF3 actions with #123C52 text. Document palettes and
rendered screenshot artwork remain controlled by each document.

`app/icons/palusa-logo.svg` is the unchanged original logo supplied with the
manual. It appears directly on the Welcome and About surfaces without an added plate.
Only add a protective background when the actual surface makes it necessary
for legibility; use a suitable monochrome application first where appropriate.

## App icon

The source artwork is `app/icons/screenshot-studio.png`, generated with the
built-in imagegen tool. `node tools/build-icon.mjs` creates the ten macOS
icon sizes and `distribution/ScreenshotStudio.icns`. Packaging verifies that
the resulting .icns is included, and the Xcode Info.plist uses the same name.
Development runs also set the Dock image explicitly.

Generation prompt:

> Use case: logo-brand. Create a polished macOS application icon for Screenshot Studio, a screenshot composition editor by PALUSA. Single square icon, 1024x1024. Transparent outside a centered rounded-square tile with generous macOS icon margins. Tile in warm off-white/sand #EEEAE3, soft tactile ceramic finish and subtle dimensional edge. Main motif: two overlapping upright screenshot cards, rear card in sky blue #2EAAE1, front card in magenta #C0338B with a few clean pale image-layout rectangles; four elegant white crop-corner marks frame the composition. Very simple bold silhouette readable at 32px, refined shallow relief, restrained soft shadow, straight-on view, minimal Scandinavian design. Violet #564797 only in subtle depth. No letters, no words, no camera lens, no Electron atom, no logos, no watermark. This is the final icon asset, not a presentation or mockup.
