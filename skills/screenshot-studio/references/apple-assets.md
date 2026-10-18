# App Store asset review

The authoritative design reference is [Apple’s asset best practices](https://developer.apple.com/app-store/asset-best-practices/). `catalog.assetGuidance` exposes the dated checklist and links to current screenshot/creative specifications and Accurate Metadata rules.

Before designing, classify each output as an app-in-use screenshot or header/search creative asset. Apply the matching checklist; preserve the document’s output assignments. Read the user’s app source and captures to substantiate feature claims and additional-purchase disclosures.

Before delivery:

1. Inspect whole-series previews for every requested canvas and language. Apply `assetReview.visualChecks` to the images, including content baked into captures and generated artwork.
2. Review each `assetReview.advisories` entry in context and edit flagged overlays where appropriate. Automated scanning covers editable text only; it does not inspect text or logos inside image files or prove the truth of claims.
3. Use Apple’s asset templates for safe areas. Check the composition across orientation and placement variants in App Store Connect Preview; Studio does not certify template-safe placement.
4. Run technical preflight and preserve native translation review status. Report unresolved editorial or visual checks alongside technical readiness. Only Apple determines acceptance.

For exact-size delivery, use the formats currently returned by `catalog.targets` and validate against Apple’s linked specifications if requirements have changed.
