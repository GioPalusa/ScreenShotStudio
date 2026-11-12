# App Store asset review

The authoritative design reference is [Apple’s asset best practices](https://developer.apple.com/app-store/asset-best-practices/). `catalog.assetGuidance` exposes the dated checklist and links to current screenshot/creative specifications and Accurate Metadata rules.

Before designing, classify each output as an app-in-use screenshot or header/search creative asset. Apply the matching checklist; preserve the document’s output assignments. Read the user’s app source and captures to substantiate feature claims and additional-purchase disclosures.

Before delivery:

1. Inspect whole-series previews for every requested canvas and language. Apply `assetReview.visualChecks` to the images, including content baked into captures and generated artwork.
2. Review each `assetReview.advisories` entry in context and edit flagged overlays where appropriate. Automated scanning covers editable text only; it does not inspect text or logos inside image files or prove the truth of claims.
3. Use Apple’s asset templates for safe areas. Check the composition across orientation and placement variants in App Store Connect Preview; Studio does not certify template-safe placement.
4. Run technical preflight and preserve native translation review status. Report unresolved editorial or visual checks alongside technical readiness. Only Apple determines acceptance.

For exact-size delivery, use the formats currently returned by `catalog.targets` and validate against Apple’s linked specifications if requirements have changed.

## Text and visual optimization

Choose the audience and the first image’s concrete promise before fine typography. Screenshots demonstrate the app in use; header/search creative assets have their own placements and official template safe areas. [Apple’s product-page guidance](https://developer.apple.com/app-store/product-page/) prioritizes the first visible images and a main benefit for each subsequent screenshot. [Apple’s format guidance](https://developer.apple.com/app-store/asset-best-practices/#format) favors brief text that adds meaning, clear focus and legibility across presentations.

Use one dominant headline with optional supporting copy as a starting composition. Give the app feature enough room to substantiate the headline. A concise label can help, but five small text levels usually deserve simplification. Preserve deliberate Bézier curves, shadows, rounded corners and other requested accents as supporting forms. Keep the headline area quiet and the app feature unobstructed. Evaluate left/center alignment and top/bottom placement in context; the available evidence establishes no universal winner.

Call `preview_project` with `details: true` for geometry and with `previewWidth: 160` and `320` for diagnostic-size images. Both preview and preflight return `textReview` even without details:

- `scenes[].layers[]`: actual rendered `size`, `lines`, `lineTexts`, `shrink`, `fallback`, `overflow`, simulated `previews` and conservative `contrast`.
- `presentation`: screenshot or creative asset type, specification link and a reminder to verify real placement/cropping. Studio applies no invented safe-area mask.
- `advisories`: small text, low known contrast and competing text sizes. These are design suggestions separate from technical `ready`; final export preserves its existing technical checks.

The default 12 px diagnostic text-size target is a design heuristic, not an Apple minimum. The 4.5:1 contrast target is a conservative readability reference from [W3C](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), not an App Store approval rule. Contrast is measured only for supported flat backgrounds with known compositing; `unknown` requires visual inspection. Affine-transformed text reports nominal size and asks for visual review. Text within captures, photographs or illustrations is not automatically analyzed. Review fallback fonts, translated line breaks and RTL layouts independently.

## Baselines and experiments

Preserve a baseline before a redesign, using Save As or a complete portable project copy. Name the alternative and record its hypothesis, changed elements and export manifest. For a controlled experiment change one factor: benefit wording, secondary text, image scale, placement, alignment or orientation. A package that changes all of them can be judged as a package, without attributing its result to one element.

Show the complete before/after series. A brief comprehension check can reveal whether unfamiliar readers understand the purpose; it does not establish conversion lift. For a real app use randomized [Product Page Optimization](https://developer.apple.com/help/app-store-connect-analytics/acquisition/product-page-optimization) and interpret the outcome with its uncertainty. Custom Product Pages help match campaign audiences; pages receiving different traffic are not interchangeable randomized controls. Check post-install quality as well as downloads. [Apple’s CPP guidance](https://developer.apple.com/videos/play/tech-talks/110361/)

Keep machine-written copy draft and request native review through the normal workflow. Describe output as visually reviewed or technically ready as supported by the actual checks. Measured optimization requires a real experiment; neither a design heuristic nor a vendor case study guarantees improvement.
