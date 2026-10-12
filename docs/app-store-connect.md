# Upload screenshots to App Store Connect

In the Mac app, choose **Upload to App Store Connect…** after exporting, or open the separate **Upload** view to upload later. **Choose export folder…** opens a saved, dated Screenshot Studio export folder containing `manifest.json` and its images. You can use an export from an earlier session or another project, without rendering it again. **File → Upload to App Store Connect…** and **Upload screenshots…** on Welcome also work without opening a project.

Completed draft exports can be uploaded. Text overflow, smaller text, cropping, fallback fonts and pending translation review are advisory: review the warnings, check **I reviewed the warnings and want to upload anyway**, then choose **Upload anyway**. This does not approve translations or alter the source project. Strict export checks remain available separately.

Technical errors still block upload: missing assets or exported images, changed image bytes, invalid RGB PNGs, invalid metadata, unsupported sizes, missing destination languages and Apple’s count limits. The app checks the frozen export again when you start. If export checks blocked upload, **Review export checks…** returns to the export selection. Direct upload requires the Mac app.

## Connect your account

1. In App Store Connect → Users and Access → Integrations, create an API key with access to the app and permission to manage its screenshots (for example, App Manager).
2. Copy the Key ID and Issuer ID. For an individual API key, leave Issuer ID empty.
3. In Screenshot Studio, enter those identifiers and choose the downloaded `.p8` file. The app verifies the connection before saving it.

The private key and identifiers are stored as one item in macOS Keychain. They are never added to `.sss` documents, exports or upload reports. **Disconnect API key** removes the saved connection; it does not revoke the key at Apple. Keep the original `.p8` file safe.

## Review and upload

Choose an app and an editable version, then **Review screenshots**. The review shows the destination, image previews, languages, screen groups, incoming image counts and existing screenshots. Apple’s current asset catalog determines accepted pixel sizes, file sizes and per-group limits. If several groups accept a canvas, choose one explicitly. Add missing languages to the selected version in App Store Connect first.

iPhone Duo open and closed share one Apple screen group and one limit of 10 screenshots per language. The review combines both canvases into one selection. Use only open, only closed, or select individual screenshots from both. The same canvas/slide selection applies to every language; exporting 14 Duo images does not require uploading all 14.

By default, existing language and screen groups are kept, and every missing group is uploaded across all exported languages. An already populated en-GB group does not block the other languages. The review lists exactly which groups will be kept; their images are not assumed to match the export. To replace a set, enable **Replace existing screenshots in the selected language and screen groups**. This affects only the groups listed in the review. Every new image must be received and its upload committed by Apple before replacement starts. Apple may still be processing the images when the existing placements are replaced. Changes made by another person after the review stop the operation before placement changes.

Click **Upload screenshots** (or **Replace and upload screenshots**) to start. The app confirms receipt, creates placements and reads back their order, including placements that Apple is still processing. This updates screenshots on the selected version; it does not submit the version for App Review or release it.

**Upload complete** confirms that Apple has received every screenshot and the selected placements and order are saved. The dialog shows the received count and an **Open App Store Connect** button. Apple continues processing independently; check processing status and any subsequent image errors in App Store Connect. Screenshot Studio does not wait for or poll processing, and you can close the dialog after completion.

## Stopping and failures

**Stop upload**, closing the upload dialog, or quitting the app stops further work. Completed remote changes remain. A stop, network interruption or failure during placement changes can leave a partially updated group. Review App Store Connect before trying again; the app deliberately does not repeat ambiguous writes automatically.

**Show upload report** reveals a JSON report in the app’s Application Support directory under `app-store-upload-reports/`. It records image IDs, placement IDs, removed placement IDs, per-image progress and final status. It contains no private keys, authentication tokens or signed upload URLs. Each image reservation uses a unique asset reference name, including the canvas and a new identifier, so prior attempts and different devices cannot cause name collisions. An image that finishes uploading but is not placed remains in the app’s Apple asset library. You can manage it in App Store Connect.

The integration uses Apple’s [App Asset Library](https://developer.apple.com/documentation/appstoreconnectapi/app-asset-library), including runtime [asset specifications](https://developer.apple.com/documentation/appstoreconnectapi/discovering-asset-specifications) and [placements](https://developer.apple.com/documentation/appstoreconnectapi/placing-assets-on-your-app-store-surfaces). The deprecated screenshot-set endpoints are not used.

## Validation boundary

Automated tests use a simulated Apple service to verify authentication, multipart transfer, completion while Apple is still processing, placement order, count limits and failure handling. Real account credentials are required to validate a live Apple upload. Tests and local Mac UI checks do not prove a live upload succeeded.
