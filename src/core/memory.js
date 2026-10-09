// 記憶システム（仕組み章 4）
import { get, put, del, getAll, getAllByIndex } from '../store/db.js';

const MAX_INJECT_PER_TURN = 2;
const COOLDOWN_TURNS = 5;
const COOLDOWN_MS = 30 * 60 * 1000;

export const normalize = (s) => (s ?? '').normalize('NFKC').toLowerCase().trim();

export function normKeywords(arr = []) {
  return [...new Set(arr.map(normalize).filter(Boolean))].slice(0, 8);
}

function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size && !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

const newId = () => crypto.randomUUID();

// ---------- 保存 ----------
export async function saveLong({ content, keywords = [], category = 'other', sourceChatId, promotedFrom }) {
  const kw = normKeywords(keywords);
  const c = normalize(content);
  const dup = (await getAll('memory')).find(
    (m) => normalize(m.content) === c || jaccard(m.keywords, kw) >= 0.6
  );
  if (dup) return { id: dup.id, duplicateOf: dup.id, created: false };

  const now = Date.now();
  const item = {
    id: newId(),
    content: content.trim(),
    keywords: kw,
    category,
    sourceChatId,
    promotedFrom,
    createdAt: now,
    updatedAt: now,
    injectCount: 0,
    enabled: true,
  };
  await put('memory', item);
  return { id: item.id, created: true };
}

export async function saveShort({ chatId, content, keywords = [] }) {
  const kw = normKeywords(keywords);
  const c = normalize(content);
  const existing = await getAllByIndex('shortTerm', 'chatId', chatId);
  const dup = existing.find((s) => normalize(s.content) === c || jaccard(s.keywords, kw) >= 0.6);
  if (dup) return { id: dup.id, duplicateOf: dup.id, created: false };

  const now = Date.now();
  const item = { id: newId(), chatId, content: content.trim(), keywords: kw, createdAt: now, updatedAt: now };
  await put('shortTerm', item);
  return { id: item.id, created: true };
}

export const listShortForChat = (chatId) => getAllByIndex('shortTerm', 'chatId', chatId);

// ---------- 検索（AIのツール呼び出し用） ----------
function scoreFor(query, keywords, content) {
  let s = 0;
  for (const k of keywords) if (k && query.includes(k)) s += 2;
  const cn = normalize(content);
  for (const tok of query.split(/\s+/)) if (tok.length >= 2 && cn.includes(tok)) s += 1;
  return s;
}

export async function searchMemory({ query, chatId, scope = 'both', limit = 3 }) {
  const q = normalize(query);
  const out = [];
  if (scope !== 'short') {
    for (const m of await getAll('memory')) {
      if (!m.enabled) continue;
      const score = scoreFor(q, m.keywords, m.content);
      if (score > 0) out.push({ id: m.id, content: m.content, scope: 'long', score });
    }
  }
  if (scope !== 'long' && chatId) {
    for (const s of await getAllByIndex('shortTerm', 'chatId', chatId)) {
      const score = scoreFor(q, s.keywords, s.content);
      if (score > 0) out.push({ id: s.id, content: s.content, scope: 'short', score });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, Math.min(limit, 5));
}

// ---------- 自動提示（キーワード検知） ----------
// 2語一致、または3文字以上の語が1つ一致した記憶を候補にする（固有名詞相当の判定）。
// 再提示は「直近5ターン以内」または「30分以内」のどちらかに当たれば抑制する（厳しい側）。
export async function selectForInjection(text, turn, cfg) {
  if (!cfg.memoryInjection) return [];
  const t = normalize(text);
  const now = Date.now();
  const cands = [];

  for (const m of await getAll('memory')) {
    if (!m.enabled) continue;
    const hits = m.keywords.filter((k) => k && t.includes(k));
    const ok = hits.length >= 2 || (hits.length >= 1 && hits.some((k) => k.length >= 3));
    if (!ok) continue;
    if (m.lastInjectedTurn != null && turn - m.lastInjectedTurn < COOLDOWN_TURNS) continue;
    if (m.lastInjectedAt && now - m.lastInjectedAt < COOLDOWN_MS) continue;
    cands.push({ m, hits: hits.length });
  }

  cands.sort((a, b) => b.hits - a.hits);
  const picked = cands.slice(0, MAX_INJECT_PER_TURN).map((c) => c.m);
  for (const m of picked) {
    m.lastInjectedAt = now;
    m.lastInjectedTurn = turn;
    m.injectCount = (m.injectCount || 0) + 1;
    await put('memory', m);
  }
  return picked;
}

// ---------- 編集・削除・昇格（設定画面用） ----------
export async function updateItem(store, id, patch) {
  const item = await get(store, id);
  if (!item) throw new Error('対象が見つかりません');
  const { keywords, ...rest } = patch;
  Object.assign(item, rest, { updatedAt: Date.now() });
  if (keywords) item.keywords = normKeywords(keywords);
  await put(store, item);
  return item;
}

export const updateMemory = (id, patch) => updateItem('memory', id, patch);
export const updateShort = (id, patch) => updateItem('shortTerm', id, patch);
export const deleteMemory = (id) => del('memory', id);
export const deleteShort = (id) => del('shortTerm', id);

export async function promote(shortId) {
  const s = await get('shortTerm', shortId);
  if (!s) throw new Error('短期記憶が見つかりません');
  const r = await saveLong({
    content: s.content,
    keywords: s.keywords,
    category: 'other',
    sourceChatId: s.chatId,
    promotedFrom: s.id,
  });
  await del('shortTerm', shortId);
  return r;
}
