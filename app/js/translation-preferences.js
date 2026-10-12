const storageKey = 'studio.translation.settings';
export async function loadTranslationPreferences(provider = null) {
  if (window.studioDesktop?.translationSettings) return window.studioDesktop.translationSettings('load', provider);
  let data = {}; try { data = JSON.parse(localStorage.getItem(storageKey) ?? '{}'); } catch {}
  provider ??= data.lastProvider ?? 'openai';
  return { ...data[provider], provider, token: '' };
}
export async function saveTranslationPreferences(value) {
  if (window.studioDesktop?.translationSettings) return window.studioDesktop.translationSettings('save', value);
  let data = {}; try { data = JSON.parse(localStorage.getItem(storageKey) ?? '{}'); } catch {}
  // Browser development mode saves only model preferences, never credentials.
  data[value.provider] = { model: value.model, models: value.models }; data.lastProvider = value.provider;
  localStorage.setItem(storageKey, JSON.stringify(data));
}
