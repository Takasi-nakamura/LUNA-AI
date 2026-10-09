// ModelRouter（仕組み章 6）: Groq → Cerebras → Gemini の自動切替
export const PROVIDERS = {
  groq: {
    label: 'Groq',
    kind: 'openai',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    models: ['openai/gpt-oss-120b'],
  },
  cerebras: {
    label: 'Cerebras',
    kind: 'openai',
    endpoint: 'https://api.cerebras.ai/v1/chat/completions',
    models: ['gpt-oss-120b'],
  },
  gemini: {
    label: 'Gemini',
    kind: 'gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/',
    models: ['gemini-3.5-flash-lite'],
  },
};

export const FALLBACK_ORDER = ['groq', 'cerebras', 'gemini'];

export class ProviderError extends Error {
  constructor(message, { status, rateLimited = false } = {}) {
    super(message);
    this.status = status;
    this.rateLimited = rateLimited;
  }
}

const isRateLimit = (status, text) =>
  status === 429 || /rate[_ ]?limit|quota|too many requests/i.test(text);

const safeParse = (s) => {
  try { return JSON.parse(s || '{}'); } catch { return {}; }
};

// ---------- OpenAI互換（Groq / Cerebras） ----------
async function callOpenAICompat(p, apiKey, model, messages, tools, signal) {
  const body = {
    model,
    messages: messages.map((m) => {
      const o = { role: m.role, content: m.content ?? '' };
      if (m.tool_calls) o.tool_calls = m.tool_calls;
      if (m.role === 'tool') o.tool_call_id = m.tool_call_id;
      return o;
    }),
    temperature: 0.7,
    max_tokens: 2048,
  };
  if (tools?.length) body.tools = tools;

  const res = await fetch(PROVIDERS[p].endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ProviderError(`${PROVIDERS[p].label} ${res.status}: ${text.slice(0, 200)}`, {
      status: res.status,
      rateLimited: isRateLimit(res.status, text),
    });
  }
  const data = JSON.parse(text);
  const msg = data.choices?.[0]?.message ?? {};
  return {
    content: msg.content ?? '',
    toolCalls: (msg.tool_calls || []).map((tc) => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.function.name, arguments: tc.function.arguments },
    })),
    model,
  };
}

// ---------- Gemini（OpenAI形式の内部表現を変換） ----------
function toGemini(messages) {
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const contents = [];
  for (const m of messages) {
    if (m.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: m.content }] });
    } else if (m.role === 'assistant') {
      const parts = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.tool_calls || []) {
        parts.push({ functionCall: { name: tc.function.name, args: safeParse(tc.function.arguments) } });
      }
      contents.push({ role: 'model', parts: parts.length ? parts : [{ text: '' }] });
    } else if (m.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name: m.name, response: { content: m.content } } }],
      });
    }
  }
  return { sys, contents };
}

async function callGemini(apiKey, model, messages, tools, signal) {
  const { sys, contents } = toGemini(messages);
  const body = { contents, generationConfig: { temperature: 0.7, maxOutputTokens: 2048 } };
  if (sys) body.systemInstruction = { parts: [{ text: sys }] };
  if (tools?.length) {
    body.tools = [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      },
    ];
  }
  const res = await fetch(`${PROVIDERS.gemini.endpoint}${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ProviderError(`Gemini ${res.status}: ${text.slice(0, 200)}`, {
      status: res.status,
      rateLimited: isRateLimit(res.status, text),
    });
  }
  const data = JSON.parse(text);
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const stamp = Date.now();
  return {
    content: parts.filter((p) => p.text).map((p) => p.text).join(''),
    toolCalls: parts
      .filter((p) => p.functionCall)
      .map((p, i) => ({
        id: `gcall_${stamp}_${i}`,
        type: 'function',
        function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args ?? {}) },
      })),
    model,
  };
}

// ---------- ルーティング ----------
export function fallbackChain(provider, autoFallback) {
  if (!autoFallback) return [provider];
  if (provider === 'gemini') return ['gemini']; // Geminiは最後の手段・手動選択のみ
  return FALLBACK_ORDER.slice(FALLBACK_ORDER.indexOf(provider));
}

async function callProxy(p, model, messages, tools, config, signal) {
  const { currentIdToken } = await import('./firebase-auth.js');
  const token = await currentIdToken();
  if (!token) throw new ProviderError('AIプロキシを使うにはFirebaseにログインしてください');
  const res = await fetch(config.apiProxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ provider: p, model, messages, tools }),
    signal,
  });
  const text = await res.text();
  if (!res.ok) throw new ProviderError('AI Proxy ' + res.status + ': ' + text.slice(0, 240), { status: res.status, rateLimited: res.status === 429 });
  const data = JSON.parse(text);
  if (p === 'gemini') {
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    return { content: parts.filter(x => x.text).map(x => x.text).join(''), toolCalls: parts.filter(x => x.functionCall).map((x, i) => ({ id: 'gcall_' + Date.now() + '_' + i, type: 'function', function: { name: x.functionCall.name, arguments: JSON.stringify(x.functionCall.args || {}) } })), model };
  }
  const msg = data.choices?.[0]?.message || {};
  return { content: msg.content || '', toolCalls: (msg.tool_calls || []).map(tc => ({ id: tc.id, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments } })), model };
}

async function callProvider(p, pc, model, messages, tools, signal, config) {
  if (config.apiProxyUrl) return callProxy(p, model, messages, tools, config, signal);
  if (PROVIDERS[p].kind === 'gemini') return callGemini(pc.apiKey, model, messages, tools, signal);
  return callOpenAICompat(p, pc.apiKey, model, messages, tools, signal);
}

/**
 * @returns {Promise<{content, toolCalls, model, provider, switched}>}
 */
export async function callModel({ messages, tools, selection, config, onSwitch, signal }) {
  const chain = fallbackChain(selection.provider, selection.autoFallback);
  let lastErr = null;

  for (let i = 0; i < chain.length; i++) {
    const p = chain[i];
    const next = chain[i + 1];
    const pc = config.providers[p];
    if (!pc?.enabled || !pc.apiKey) {
      lastErr = new ProviderError(`${PROVIDERS[p].label} のAPIキーが未設定です`);
      continue;
    }
    const model = p === selection.provider ? selection.model : PROVIDERS[p].models[0];
    try {
      const r = await callProvider(p, pc, model, messages, tools, signal, config);
      return { ...r, provider: p, switched: i > 0 };
    } catch (e) {
      lastErr = e;
      if (signal?.aborted) throw e;
      if (next) {
        const limited = e.rateLimited;
        onSwitch?.({
          from: p,
          to: next,
          reason: limited ? 'rate_limit' : 'error',
          message: `${PROVIDERS[p].label} の${limited ? '上限に達した' : 'エラーが発生した'}ため、${PROVIDERS[next].label} に切り替えました`,
        });
      }
    }
  }
  throw lastErr ?? new Error('利用可能なモデルがありません。設定でAPIキーを入力してください。');
}
