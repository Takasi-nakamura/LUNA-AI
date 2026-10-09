// Orchestrator（仕組み章 3.1）: コンテキスト構築 → モデル呼び出し → ツールループ → LSE → 保存
import { patchConfig } from '../store/config.js';
import { get, put, getAllByIndex } from '../store/db.js';
import { callModel, PROVIDERS } from './router.js';
import { lseFilter } from './lse.js';
import { listSkills, expandSkills } from './skills.js';
import { selectForInjection, listShortForChat } from './memory.js';
import { TOOL_SCHEMAS, runTool } from './tools.js';

const MAX_TOOL_STEPS = 5;
const HISTORY_LIMIT = 20;

const BASE_SYSTEM = [
  'あなたはLUNA（ユーザー専用のAIアシスタント）です。日本語で、簡潔かつ正確に答えてください。',
  '',
  '【表示形式】',
  '- マインドマップは ```luna:mindmap ブロック内に、インデント付きの箇条書きで書く。',
  '- 手順はステップカードとして ```luna:steps ブロック内に「# タイトル」と「番号. 見出し :: 本文」の行で書く。',
  '- 表やコードはMarkdownの表・コードブロックで書く。',
  '',
  '【記憶】',
  '- 今後も役立つ情報（ユーザーの好み・プロジェクト情報など）だけ memory_save で保存する。雑談や一時的な話題は保存しない。',
  '- 参考情報として提示された記憶は、関係がある時だけ自然に使う。記憶の存在に毎回言及しない。',
  '',
  '【検索】',
  '- 最新情報や事実確認が必要な時は web_search を使い、参照したソースを回答に示す。',
].join('\n');

const mkMsg = (chatId, role, content) => ({
  id: crypto.randomUUID(),
  chatId,
  role,
  content,
  createdAt: Date.now(),
});

const safeJson = (s) => {
  try { return JSON.parse(s || '{}'); } catch { return {}; }
};

function buildSystem({ applied, memories, shorts }) {
  const parts = [BASE_SYSTEM];
  if (applied.length) {
    parts.push(
      '【スキル指示（ユーザーが呼び出したもの）】\n' +
        applied.map((s) => `### /${s.name}（${s.title}）\n${s.instruction}`).join('\n\n')
    );
  }
  if (memories.length) {
    parts.push(
      '[Memory: 参考情報。関連する場合のみ自然に使うこと。言及は不要な場合は省略]\n' +
        memories.map((m) => `- (id:${m.id}) ${m.content}`).join('\n')
    );
  }
  if (shorts.length) {
    parts.push(
      '[会話短期記憶：このチャット内のみ有効]\n' +
        shorts.map((s) => `- (id:${s.id}) ${s.content}`).join('\n')
    );
  }
  return parts.join('\n\n');
}

/**
 * 1ターン実行。ui は { appendMessage, toast, onSwitch } を持つ。
 */
export async function runTurn({ chatId, input, ui, signal }) {
  const chat = await get('chats', chatId);
  if (!chat) throw new Error('チャットが見つかりません');

  const cfg = await patchConfig((c) => { c.turn = (c.turn || 0) + 1; });
  const turn = cfg.turn;

  const { cleanedInput, applied, unknown } = expandSkills(input, await listSkills());
  if (unknown.length) ui.toast(`スキルが見つかりません: ${unknown.map((u) => '/' + u).join(' ')}`);
  const userText = cleanedInput || input;

  const userMsg = mkMsg(chatId, 'user', input);
  await put('messages', userMsg);
  ui.appendMessage(userMsg);

  if (chat.title === '新しいチャット') chat.title = userText.slice(0, 24);
  chat.updatedAt = Date.now();
  await put('chats', chat);

  const history = (await getAllByIndex('messages', 'chatId', chatId))
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-HISTORY_LIMIT);
  const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant')?.content ?? '';

  const memories = await selectForInjection(`${userText}\n${lastAssistant.slice(0, 300)}`, turn, cfg);
  const shorts = await listShortForChat(chatId);

  const wire = [{ role: 'system', content: buildSystem({ applied, memories, shorts }) }];
  for (const m of history) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    wire.push({ role: m.role, content: m.id === userMsg.id ? userText : m.content });
  }

  const ctx = { chatId, sources: [] };
  let finalText = '';
  let provider = chat.modelSelection.provider;

  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    const res = await callModel({
      messages: wire,
      tools: TOOL_SCHEMAS,
      selection: chat.modelSelection,
      config: cfg,
      onSwitch: ui.onSwitch,
      signal,
    });
    provider = res.provider;

    if (res.toolCalls?.length) {
      wire.push({ role: 'assistant', content: res.content || '', tool_calls: res.toolCalls });
      for (const tc of res.toolCalls) {
        const out = await runTool(tc.function.name, safeJson(tc.function.arguments), ctx)
          .catch((e) => ({ error: e.message }));
        wire.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify(out) });
      }
      continue;
    }
    finalText = res.content || '';
    break;
  }

  // プロバイダが切り替わった場合、以後のターンも切替先を維持する
  if (provider !== chat.modelSelection.provider) {
    const fresh = (await get('chats', chatId)) ?? chat;
    fresh.modelSelection = { ...fresh.modelSelection, provider, model: PROVIDERS[provider].models[0] };
    await put('chats', fresh);
  }

  if (!finalText) finalText = '（応答を生成できませんでした。もう一度お試しください）';

  const { blocks } = lseFilter(finalText);
  const msg = {
    ...mkMsg(chatId, 'assistant', finalText),
    blocks,
    sources: ctx.sources.length ? ctx.sources : undefined,
    provider,
  };
  await put('messages', msg);
  ui.appendMessage(msg);
  return msg;
}
