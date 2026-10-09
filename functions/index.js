const { onRequest } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
initializeApp();

const PROVIDERS = {
  groq: { url: 'https://api.groq.com/openai/v1/chat/completions', env: 'GROQ_API_KEY' },
  cerebras: { url: 'https://api.cerebras.ai/v1/chat/completions', env: 'CEREBRAS_API_KEY' },
  gemini: { url: 'https://generativelanguage.googleapis.com/v1beta/models/', env: 'GEMINI_API_KEY' },
};
const allowedOrigin = 'https://takasi-nakamura.github.io';
exports.aiChat = onRequest({ cors: [allowedOrigin], timeoutSeconds: 120, memory: '256MiB' }, async (req, res) => {
  res.set('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const origin = req.get('origin') || '';
    if (origin && origin !== allowedOrigin) return res.status(403).json({ error: 'Origin not allowed' });
    const authHeader = req.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Firebase sign-in required' });
    await getAuth().verifyIdToken(authHeader.slice(7));
    const { provider, model, messages, tools } = req.body || {};
    const p = PROVIDERS[provider];
    if (!p || !Array.isArray(messages) || !model) return res.status(400).json({ error: 'Invalid request' });
    const key = process.env[p.env];
    if (!key) return res.status(503).json({ error: p.env + ' is not configured on the server' });
    let upstreamUrl = p.url;
    let headers = { 'Content-Type': 'application/json' };
    let body;
    if (provider === 'gemini') {
      const system = messages.filter(m => m.role === 'system').map(m => m.content || '').join('\n\n');
      const contents = [];
      for (const m of messages) {
        if (m.role === 'user') contents.push({ role: 'user', parts: [{ text: m.content || '' }] });
        else if (m.role === 'assistant') {
          const parts = [];
          if (m.content) parts.push({ text: m.content });
          for (const tc of m.tool_calls || []) {
            let args = {}; try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
            parts.push({ functionCall: { name: tc.function.name, args } });
          }
          contents.push({ role: 'model', parts: parts.length ? parts : [{ text: '' }] });
        } else if (m.role === 'tool') {
          let response = {}; try { response = JSON.parse(m.content || '{}'); } catch { response = { content: m.content }; }
          contents.push({ role: 'user', parts: [{ functionResponse: { name: m.name, response } }] });
        }
      }
      upstreamUrl += encodeURIComponent(model) + ':generateContent';
      headers['x-goog-api-key'] = key;
      body = { contents, generationConfig: { temperature: 0.7, maxOutputTokens: 2048 } };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      if (tools?.length) body.tools = [{ functionDeclarations: tools.map(t => ({ name: t.function.name, description: t.function.description, parameters: t.function.parameters })) }];
    } else {
      headers.Authorization = 'Bearer ' + key;
      body = { model, messages, temperature: 0.7, max_tokens: 2048 };
      if (tools?.length) body.tools = tools;
    }
    const upstream = await fetch(upstreamUrl, { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await upstream.text();
    res.status(upstream.status).set('Content-Type', 'application/json').send(text);
  } catch (err) {
    console.error('aiChat error', err);
    const status = err.code === 'auth/id-token-expired' || err.code === 'auth/argument-error' ? 401 : 500;
    res.status(status).json({ error: status === 401 ? 'Firebase sign-in expired. Sign in again.' : 'AI proxy failed' });
  }
});
