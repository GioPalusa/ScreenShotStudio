import { EXPORT_TARGETS, exportTarget } from './export-targets.js';
import { TEXT_REVIEW_POLICY } from './text-review.js';

export const APP_STORE_ASSET_GUIDANCE = {
  source: 'https://developer.apple.com/app-store/asset-best-practices/',
  reviewSource: 'https://developer.apple.com/app-store/review/guidelines/#accurate-metadata',
  screenshotSpecs: 'https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/',
  creativeSpecs: 'https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications/',
  checkedAt: '2026-11-12',
  productPageSource: 'https://developer.apple.com/app-store/product-page/',
  previewSource: 'https://developer.apple.com/news/?id=ljpl7kyn',
  optimization: {
    textReview: TEXT_REVIEW_POLICY,
    priority: ['Make the first image explain the app and its benefit.', 'Keep one dominant promise with optional supporting text.', 'Show readable app evidence for that promise.', 'Test text placement, alignment and orientation as separate hypotheses.'],
    experiments: 'Keep a baseline and a named variant with its hypothesis and intended difference. A simultaneous redesign tests the package, not the effect of any one change. Use randomised Product Page Optimization for causal comparison; different CPP traffic sources confound raw comparisons.',
    evidence: 'No universal best headline position, word count, font size or text-area percentage is established. Design targets are heuristics, not Apple rules or guaranteed conversion improvements.',
    reference: 'screenshot-studio://guide/apple-assets',
  },
  visualChecks: [
    'Screenshots show real app use; lead with the strongest benefits and a coherent sequence, rather than title art or calls to action alone.',
    'Header artwork expresses one clear idea. Search artwork makes the app’s purpose immediately clear. Keep both visually consistent with the app.',
    'Use short, legible overlays that complement the visuals. Localize for supported languages and review each rendered variant.',
    'Inspect textReview at small display sizes: text that fits the export may still be too small to read. Review baked-in capture text visually.',
    'For creative assets, keep essential text and focal artwork within the official template safe areas for that placement. Screenshots need their own composition review. Confirm both in App Store Connect Preview; do not invent universal pixel margins.',
    'Keep pricing, discounts, URLs, copyright symbols, unsupported claims, Apple editorial recognitions and unrelated platform branding out of the assets.',
    'Use inclusive imagery appropriate for a 4+ audience. Review content rights and fictionalize personal account information.',
    'Accurately represent available features and identify featured content that requires an additional purchase.',
  ],
};

/** Advisory text checks complement visual review; they do not certify compliance or block technical export. */
export function appStoreCopyAdvisories(scene, textFor) {
  const target = exportTarget(scene.deviceDef), policy = EXPORT_TARGETS[target];
  if (!policy || ['custom', 'unknown'].includes(target) || policy.store === 'google-play') return [];
  const rules = [
    ['website', /https?:\/\/|www\./i, 'Review the website URL in this overlay against Apple’s asset guidance.'],
    ['pricing', /[$€£¥]\s*\d|\d+(?:[.,]\d{1,2})?\s*(?:USD|EUR|GBP|SEK|kr)\b/i, 'Review specific pricing in this overlay against Apple’s asset guidance.'],
    ['copyright', /©/, 'Remove the copyright symbol from this overlay.'],
    ['recognition', /\b(?:editor[’']?s choice|app of the day|game of the day|apple design award)\b/i, 'Review Apple editorial recognition in this overlay; Apple’s guidance excludes these labels.'],
    ['platform', /\b(?:android|google play|appgallery)\b/i, 'Review other-platform references in this overlay and any applicable approved-functionality exception.'],
  ];
  return scene.layers.filter(l => l.type === 'text' && !l.hidden && (l.opacity ?? 1) > 0).flatMap(layer => {
    const value = textFor(layer), text = Array.isArray(value) ? value.join(' ') : String(value ?? '');
    return rules.filter(([, pattern]) => pattern.test(text)).map(([code, , message]) => ({ code: `apple-asset-${code}`, message, layer: layer.id, locale: scene.localeId, device: scene.deviceId, slide: scene.slideId }));
  });
}
