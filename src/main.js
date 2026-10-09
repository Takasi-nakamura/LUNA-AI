import { openDB, getAll, getAllByIndex, get, put, deleteChatCascade } from './store/db.js';
import { getConfig } from './store/config.js';
import { PROVIDERS } from './core/router.js';
import { runTurn } from './core/orchestrator.js';
import { lseFilter } from './core/lse.js';
import { listSkills } from './core/skills.js';
import { renderBlocks, renderSources } from './ui/render.js';
import { toast, showSwitch, showAsk } from './ui/popups.js';
import { renderSettings } from './ui/settings.js';

const $ = (s) => document.querySelector(s);
const els = {
  select: $('#chatSelect'),
  newBtn: $('#newChat'),
  delBtn: $('#delChat'),
  setBtn: $('#openSettings'),
  backBtn: $('#closeSettings'),
  chatView: $('#chatView'),
  settingsView: $('#settingsView'),
  settingsRoot: $('#settingsRoot'),
  messages: $('#messages'),
  form: $('#composer'),
  input: $('#input'),
  sendBtn: $('#send'),
  stopBtn: $('#stop'),
  suggest: $('#suggest'),
};
const state = { chatId: null, busy: false, ctrl: null };

const ui = {
  appendMessage: (m) => appendMessage(m, { live: true }),
  toast,
  onSwitch: (e) => showSwitch(e, () => revertProvider(e)),
};

// ---------- チャット ----------
async function createChat() {
  const cfg = await getConfig();
  const chat = {
    id: crypto.randomUUID(),
    title: '新しいチャット',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    modelSelection: {
      provider: cfg.defaultProvider,
      model: PROVIDERS[cfg.defaultProvider].models[0],
      autoFallback: cfg.autoFallback,
    },
  };
  await put('chats', chat);
  return chat;
}

async function refreshChats(selectId) {
  const chats = (await getAll('chats')).sort((a, b) => b.updatedAt - a.updatedAt);
  if (!chats.length) {
    const c = await createChat();
    return refreshChats(c.id);
  }
  state.chatId = chats.some((c) => c.id === selectId) ? selectId : chats[0].id;
  els.select.innerHTML = '';
  for (const c of chats) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.title;
    els.select.append(o);
  }
  els.select.value = state.chatId;
  await renderHistory();
}

async function renderHistory() {
  els.messages.innerHTML = '';
  const msgs = (await getAllByIndex('messages', 'chatId', state.chatId)).sort((a, b) => a.createdAt - b.createdAt);
  for (const m of msgs) appendMessage(m, { live: false });
  scrollBottom();
}

function appendMessage(msg, { live = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${msg.role}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (msg.role === 'user') {
    bubble.textContent = msg.content;
  } else {
    const blocks = msg.blocks ?? lseFilter(msg.content).blocks;
    bubble.append(renderBlocks(blocks, { onAsk: live ? (b) => showAsk(b, sendText) : undefined }));
    if (msg.sources?.length) bubble.append(renderSources(msg.sources));
  }
  wrap.append(bubble);
  els.messages.append(wrap);
  scrollBottom();
  return wrap;
}

function scrollBottom() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

async function revertProvider(e) {
  const chat = await get('chats', state.chatId);
  if (!chat) return;
  chat.modelSelection = { ...chat.modelSelection, provider: e.from, model: PROVIDERS[e.from].models[0] };
  await put('chats', chat);
  toast(`${PROVIDERS[e.from].label} に戻しました`);
}

// ---------- 送信 ----------
async function sendText(text) {
  const t = text.trim();
  if (!t || state.busy) return;
  state.busy = true;
  state.ctrl = new AbortController();
  els.sendBtn.disabled = true;
  els.stopBtn.hidden = false;
  try {
    await runTurn({ chatId: state.chatId, input: t, ui, signal: state.ctrl.signal });
    await refreshChats(state.chatId);
  } catch (e) {
    if (e.name === 'AbortError') toast('停止しました');
    else {
      console.error(e);
      toast(`エラー: ${e.message}`, 6000);
    }
  } finally {
    state.busy = false;
    state.ctrl = null;
    els.sendBtn.disabled = false;
    els.stopBtn.hidden = true;
  }
}

function autosize() {
  els.input.style.height = 'auto';
  els.input.style.height = `${Math.min(els.input.scrollHeight, 160)}px`;
}

// /スキル名 のサジェスト
async function updateSuggest() {
  const m = els.input.value.match(/(?:^|\s)\/([A-Za-z0-9_-]*)$/);
  if (!m) { els.suggest.hidden = true; return; }
  const q = m[1].toLowerCase();
  const list = (await listSkills()).filter((s) => s.name.toLowerCase().startsWith(q)).slice(0, 6);
  els.suggest.innerHTML = '';
  if (!list.length) { els.suggest.hidden = true; return; }
  for (const s of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `/${s.name}  ${s.title}`;
    b.onclick = () => {
      els.input.value = els.input.value.replace(/\/([A-Za-z0-9_-]*)$/, `/${s.name} `);
      els.suggest.hidden = true;
      els.input.focus();
    };
    els.suggest.append(b);
  }
  els.suggest.hidden = false;
}

// ---------- イベント ----------
els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = els.input.value;
  els.input.value = '';
  autosize();
  els.suggest.hidden = true;
  sendText(v);
});
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    els.form.requestSubmit();
  }
});
els.input.addEventListener('input', () => { autosize(); updateSuggest(); });
els.stopBtn.addEventListener('click', () => state.ctrl?.abort());

els.select.addEventListener('change', () => refreshChats(els.select.value));
els.newBtn.addEventListener('click', async () => {
  const c = await createChat();
  await refreshChats(c.id);
});
els.delBtn.addEventListener('click', async () => {
  if (!state.chatId) return;
  if (!confirm('このチャットを削除しますか？（このチャットの短期記憶も消えます）')) return;
  await deleteChatCascade(state.chatId);
  await refreshChats();
});
els.setBtn.addEventListener('click', () => {
  els.chatView.hidden = true;
  els.settingsView.hidden = false;
  renderSettings(els.settingsRoot);
});
els.backBtn.addEventListener('click', () => {
  els.settingsView.hidden = true;
  els.chatView.hidden = false;
  refreshChats(state.chatId);
});

// ---------- 起動 ----------
async function boot() {
  await openDB();
  await refreshChats();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.error('SW register failed', e));
  }
}

boot().catch((e) => {
  console.error(e);
  toast(`起動に失敗しました: ${e.message}`, 8000);
});
