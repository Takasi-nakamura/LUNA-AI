import { get, put } from './db.js';

export const DEFAULT_CONFIG = {
  providers: {
    groq: { apiKey: '', enabled: true },
    cerebras: { apiKey: '', enabled: true },
    gemini: { apiKey: '', enabled: true },
  },
  autoFallback: true,
  defaultProvider: 'groq',
  searchApiKey: '',
  memoryInjection: true,
  turn: 0,
};

export async function getConfig() {
  const saved = (await get('settings', 'config'))?.value || {};
  const providers = {};
  for (const id of Object.keys(DEFAULT_CONFIG.providers)) {
    providers[id] = { ...DEFAULT_CONFIG.providers[id], ...(saved.providers?.[id] || {}) };
  }
  return { ...DEFAULT_CONFIG, ...saved, providers };
}

// fn は cfg を直接書き換えてよい。返り値があればそれを保存する。
export async function patchConfig(fn) {
  const cfg = await getConfig();
  const next = fn(cfg) || cfg;
  await put('settings', { key: 'config', value: next });
  return next;
}
