// The languages App Store Connect accepts for screenshots, and what the studio needs to know about each.
// Ids are App Store Connect's own codes - they must match the folder names in AppStore/fastlane/metadata.
//
// The catalog only has what Intl cannot tell us: the id, the language tag used for text shaping and line
// breaking, the writing direction, and a system-font hint for scripts that need one. Names (in English and
// in the language itself) come from Intl.DisplayNames.

/** [id, lang, dir?, font?] - lang is the BCP-47 tag handed to the canvas and the line breaker. */
const ENTRIES = [
  ['ar-SA', 'ar', 'rtl', { family: '"SF Arabic Rounded", "SF Arabic", "Geeza Pro", sans-serif', lineHeight: 1.12 }],
  ['bg', 'bg'],
  ['bn-BD', 'bn', 'ltr', { family: '"SF Pro Rounded", "Bangla Sangam MN", sans-serif', lineHeight: 1.2 }],
  ['ca', 'ca'],
  ['cs', 'cs'],
  ['da', 'da'],
  ['de-DE', 'de'],
  ['el', 'el'],
  ['en-AU', 'en-AU'],
  ['en-CA', 'en-CA'],
  ['en-GB', 'en-GB'],
  ['en-US', 'en-US'],
  ['es-ES', 'es'],
  ['es-MX', 'es-MX'],
  ['fi', 'fi'],
  ['fr-CA', 'fr-CA'],
  ['fr-FR', 'fr'],
  ['gu-IN', 'gu', 'ltr', { family: '"SF Pro Rounded", "Gujarati Sangam MN", sans-serif', lineHeight: 1.2 }],
  ['he', 'he', 'rtl', { family: '"SF Hebrew Rounded", "SF Hebrew", "Arial Hebrew", sans-serif', lineHeight: 1.06 }],
  ['hi', 'hi', 'ltr', { family: '"SF Pro Rounded", "Kohinoor Devanagari", "Devanagari Sangam MN", sans-serif', lineHeight: 1.16 }],
  ['hr', 'hr'],
  ['hu', 'hu'],
  ['id', 'id'],
  ['it', 'it'],
  ['ja', 'ja', 'ltr', { family: '"SF Pro Rounded", "Hiragino Sans", "Hiragino Kaku Gothic ProN", sans-serif', lineHeight: 1.12 }],
  ['kn-IN', 'kn', 'ltr', { family: '"SF Pro Rounded", "Kannada Sangam MN", sans-serif', lineHeight: 1.2 }],
  ['ko', 'ko', 'ltr', { family: '"SF Pro Rounded", "Apple SD Gothic Neo", sans-serif', lineHeight: 1.12 }],
  ['ml-IN', 'ml', 'ltr', { family: '"SF Pro Rounded", "Malayalam Sangam MN", sans-serif', lineHeight: 1.2 }],
  ['mr-IN', 'mr', 'ltr', { family: '"SF Pro Rounded", "Kohinoor Devanagari", "Devanagari Sangam MN", sans-serif', lineHeight: 1.16 }],
  ['ms', 'ms'],
  ['nl-NL', 'nl'],
  ['no', 'nb'],
  ['or-IN', 'or', 'ltr', { family: '"SF Pro Rounded", "Oriya Sangam MN", sans-serif', lineHeight: 1.2 }],
  ['pa-IN', 'pa', 'ltr', { family: '"SF Pro Rounded", "Gurmukhi Sangam MN", sans-serif', lineHeight: 1.2 }],
  ['pl', 'pl'],
  ['pt-BR', 'pt-BR'],
  ['pt-PT', 'pt-PT'],
  ['ro', 'ro'],
  ['ru', 'ru'],
  ['sk', 'sk'],
  ['sl-SI', 'sl'],
  ['sv', 'sv'],
  ['ta-IN', 'ta', 'ltr', { family: '"SF Pro Rounded", "Tamil Sangam MN", sans-serif', lineHeight: 1.2 }],
  ['te-IN', 'te', 'ltr', { family: '"SF Pro Rounded", "Telugu Sangam MN", sans-serif', lineHeight: 1.2 }],
  ['th', 'th', 'ltr', { family: '"SF Pro Rounded", "Thonburi", "Sukhumvit Set", sans-serif', lineHeight: 1.25 }],
  ['tr', 'tr'],
  ['uk', 'uk'],
  ['ur-PK', 'ur', 'rtl', { family: '"SF Arabic Rounded", "SF Arabic", "Geeza Pro", sans-serif', lineHeight: 1.2 }],
  ['vi', 'vi'],
  ['zh-Hans', 'zh-Hans', 'ltr', { family: '"SF Pro Rounded", "PingFang SC", sans-serif', lineHeight: 1.12 }],
  ['zh-Hant', 'zh-Hant', 'ltr', { family: '"SF Pro Rounded", "PingFang TC", sans-serif', lineHeight: 1.12 }],
];

/** Common capture-language choices; projects can add any supported language. */
const APP_UI_LANGS = new Set(['ar', 'de', 'en', 'es', 'fr', 'he', 'hi', 'it', 'ja', 'pt', 'ru', 'sv', 'zh-Hans']);

const shorten = (name) => name.replace('United States', 'US').replace('United Kingdom', 'UK');

function displayNames(locale, languageDisplay = 'standard') {
  try { return new Intl.DisplayNames([locale], { type: 'language', languageDisplay }); } catch { return null; }
}

/** English and native name for a locale id / tag. */
export function localeNames(id, lang) {
  const safeOf = (names, tag) => { try { return names?.of(tag); } catch { return undefined; } }; // Intl throws for tags it cannot parse
  const english = safeOf(displayNames('en'), id) ?? id;
  const nativeRaw = safeOf(displayNames(lang), id) ?? english;
  const native = nativeRaw.charAt(0).toLocaleUpperCase(lang) + nativeRaw.slice(1);
  return { name: shorten(english), native: shorten(native) };
}

/** Everything the studio can offer, with names filled in. */
export function localeCatalog() {
  return ENTRIES.map(([id, lang, dir = 'ltr', font]) => {
    const { name, native } = localeNames(id, lang);
    return { id, lang, dir, font, name, native, appUI: APP_UI_LANGS.has(lang) || APP_UI_LANGS.has(lang.split('-')[0]) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** The studio.json entry for a catalog language (font only when the script needs one). */
export function localeEntry(catalogItem) {
  const { id, name, native, lang, dir, appUI, font } = catalogItem;
  return { id, name, native, lang, dir, appUI, ...(font ? { font } : {}) };
}

/** A locale id that is not in the catalog (typed by hand): guess the language tag and direction. */
export function customLocaleEntry(id, name = null) {
  const lang = id.split('-')[0];
  const names = localeNames(id, id);
  return { id, name: name || names.name, native: names.native, lang: id, dir: ['ar', 'he', 'fa', 'ur', 'yi'].includes(lang) ? 'rtl' : 'ltr', appUI: false };
}

/** Whether an id looks like an App Store Connect locale folder name (en-US, zh-Hans, he, ...). */
export const isLocaleId = (id) => /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(id);
