// AI TOOLS（仕組み章 5）
import { getConfig } from '../store/config.js';
import { saveLong, saveShort, searchMemory, promote } from './memory.js';

export const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '最新情報や事実確認のためにWeb検索する。結果のURLは回答のソースとして示すこと。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '検索クエリ（短く具体的に）' },
          limit: { type: 'integer', description: '件数（1〜8）' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory_search',
      description: 'ユーザーの長期記憶・このチャットの短期記憶を検索する。過去の情報が必要な時だけ使う。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          scope: { type: 'string', enum: ['long', 'short', 'both'] },
          limit: { type: 'integer' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory_save',
      description: '今後も役立つ情報だけを保存する。雑談や一時的な話題は保存しない。scope=short はこのチャット限定。',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['long', 'short'] },
          content: { type: 'string', description: '1〜3文の記憶本文' },
          keywords: { type: 'array', items: { type: 'string' }, description: '3〜6語の関連ワード' },
          category: { type: 'string', enum: ['profile', 'preference', 'project', 'fact', 'other'] },
        },
        required: ['scope', 'content', 'keywords'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory_promote',
      description: 'このチャットの短期記憶を長期記憶に昇格させる。',
      parameters: {
        type: 'object',
        properties: { shortTermId: { type: 'string' } },
        required: ['shortTermId'],
      },
    },
  },
];

// Web検索：Cloudflare Workerを経由し、Tavilyの秘密キーをブラウザに置かない
async function webSearch(query, limit, ctx) {
  const cfg = await getConfig();
  const endpoint = (cfg.searchWorkerUrl || '').trim().replace(/\\/$/, '');
  if (!endpoint) {
    return { error: 'Web検索Worker URLが未設定です（設定 > モデル > Web検索Worker URL）。Cloudflare Workerを先に設定してください。' };
  }

  const n = Math.min(Math.max(Number(limit) || 5, 1), 8);
  let res;
  try {
    res = await fetch(`${endpoint}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, max_results: n }),
    });
  } catch {
    return { error: 'Web検索Workerに接続できません。URLとCloudflare Workerの公開状態を確認してください。' };
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { error: data.error || `Web検索に失敗しました (${res.status})` };
  }

  const retrievedAt = Date.now();
  const results = (data.results || []).slice(0, n).map((r) => ({
    title: r.title || '',
    url: r.url || '',
    snippet: (r.content || '').slice(0, 300),
    retrievedAt,
  }));
  ctx.sources.push(...results);
  return { results: results.map(({ retrievedAt: _, ...r }) => r) };
}

export async function runTool(name, args, ctx) {
  switch (name) {
    case 'web_search':
      return webSearch(args.query, args.limit, ctx);
    case 'memory_search':
      return {
        items: await searchMemory({
          query: args.query,
          chatId: ctx.chatId,
          scope: args.scope || 'both',
          limit: args.limit || 3,
        }),
      };
    case 'memory_save':
      if (args.scope === 'short') {
        return saveShort({ chatId: ctx.chatId, content: args.content, keywords: args.keywords });
      }
      return saveLong({
        content: args.content,
        keywords: args.keywords,
        category: args.category,
        sourceChatId: ctx.chatId,
      });
    case 'memory_promote':
      return promote(args.shortTermId);
    default:
      return { error: `unknown tool: ${name}` };
  }
}
