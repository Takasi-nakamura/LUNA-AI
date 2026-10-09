import { openDB, getAll, getAllByIndex, get, put, del, deleteChatCascade } from './store/db.js';
import { getConfig } from './store/config.js';
import { PROVIDERS } from './core/router.js';
import { runTurn } from './core/orchestrator.js';
import { lseFilter } from './core/lse.js';
import { listSkills } from './core/skills.js';
import { renderBlocks, renderSources } from './ui/render.js';
import { toast, showSwitch, showAsk } from './ui/popups.js';
import { renderSettings } from './ui/settings.js';
import { configureFirebase, observeAuth } from './core/firebase-auth.js';

const $ = (s) => document.querySelector(s);
const els = {
  shell: $('.app-shell'),
  sidebar: $('#sidebar'),
  scrim: $('#sidebarScrim'),
  openSidebar: $('#openSidebar'),
  closeSidebar: $('#closeSidebar'),
  chatList: $('#chatList'),
  chatCount: $('#chatCount'),
  workspaceHeading: $('#workspaceHeading'),
  branchSelect: $('#branchSelect'),
  select: $('#chatSelect'),
  newBtn: $('#newChat'),
  delBtn: $('#delChat'),
  setBtn: $('#openSettings'),
  skillsBtn: $('#openSkills'),
  accountBtn: $('#openAccount'),
  backBtn: $('#closeSettings'),
  settingsTitle: $('#settingsTitle'),
  chatView: $('#chatView'),
  settingsView: $('#settingsView'),
  settingsRoot: $('#settingsRoot'),
  messages: $('#messages'),
  welcome: $('#welcome'),
  form: $('#composer'),
  input: $('#input'),
  sendBtn: $('#send'),
  stopBtn: $('#stop'),
  suggest: $('#suggest'),
  plusButton: $('#plusButton'),
  addMenu: $('#addMenu'),
  addSkill: $('#addSkill'),
  addFile: $('#addFile'),
  fileInput: $('#fileInput'),
  attachmentTray: $('#attachmentTray'),
};
const state = { chatId: null, busy: false, ctrl: null, attachments: [], sidebarOpen: true, activeSettings: 'models' };
const isMobile = () => window.matchMedia('(max-width: 760px)').matches;
window.addEventListener('error', (event) => {
  console.error('[LUNA UI error]', event.error || event.message);
  const root = document.querySelector('#toastRoot');
  if (root) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = '画面エラーが発生しました。ページを再読み込みしてください。';
    root.append(t);
    window.setTimeout(() => t.remove(), 6000);
  }
});
window.addEventListener('unhandledrejection', (event) => {
  console.error('[LUNA async error]', event.reason);
});
const ui = {
  appendMessage: (m) => appendMessage(m, { live: true }),
  startThinking: () => startThinking(),
  appendStreaming: (m) => appendStreaming(m),
  toast,
  onSwitch: (e) => showSwitch(e, () => revertProvider(e)),
};

function iconLabel(file) {
  const ext = (file.name.split('.').pop() || 'FILE').toUpperCase();
  return ext.length > 5 ? ext.slice(0, 4) : ext;
}
function formatBytes(size) {
  if (size < 1024) return size + ' B';
  if (size < 1024 * 1024) return (size / 1024).toFixed(0) + ' KB';
  return (size / (1024 * 1024)).toFixed(1) + ' MB';
}
function setSidebar(open) {
  state.sidebarOpen = open;
  if (isMobile()) {
    els.sidebar.hidden = false;
    els.sidebar.classList.toggle('mobile-open', open);
    els.scrim.hidden = !open;
    els.shell.classList.toggle('sidebar-closed', !open);
  } else {
    els.sidebar.hidden = !open;
    els.shell.classList.toggle('sidebar-closed', !open);
    els.scrim.hidden = true;
  }
}
function openSettings(tab = 'models') {
  state.activeSettings = tab;
  els.chatView.hidden = true;
  els.settingsView.hidden = false;
  els.settingsTitle.textContent = tab === 'skills' ? 'Skills' : tab === 'account' ? 'アカウント' : '設定';
  if (tab === 'account') {
    els.settingsRoot.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    const title = document.createElement('h3');
    title.textContent = 'アカウント設定';
    const desc = document.createElement('p');
    desc.className = 'muted';
    desc.textContent = 'Firebase AuthenticationでGoogleまたはメールアドレスによるログインができます。';
    const go = document.createElement('button');
    go.type = 'button'; go.className = 'primary'; go.textContent = 'Firebase設定・ログインを開く';
    go.onclick = () => openSettings('models');
    card.append(title, desc, go);
    els.settingsRoot.append(card);
  } else {
    renderSettings(els.settingsRoot, tab === 'skills' ? 'skills' : 'models');
  }
  if (isMobile()) setSidebar(false);
}
function closeSettings() {
  els.settingsView.hidden = true;
  els.chatView.hidden = false;
  refreshChats(state.chatId);
}
function openModal({ title, message, inputValue, confirmLabel = '確認', danger = false, onConfirm }) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const modal = document.createElement('div');
  modal.className = 'modal';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const desc = document.createElement('p');
  desc.textContent = message;
  modal.append(heading, desc);
  let field = null;
  if (inputValue !== undefined) {
    field = document.createElement('input');
    field.value = inputValue;
    field.maxLength = 100;
    field.setAttribute('aria-label', title);
    modal.append(field);
  }
  const row = document.createElement('div');
  row.className = 'row';
  row.style.justifyContent = 'flex-end';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'キャンセル';
  cancel.onclick = () => overlay.remove();
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = danger ? '' : 'primary';
  if (danger) { ok.style.background = '#fff0f0'; ok.style.color = '#c43d4a'; ok.style.border = '1px solid #f5d6d9'; ok.style.borderRadius = '11px'; ok.style.padding = '9px 13px'; }
  ok.textContent = confirmLabel;
  ok.onclick = async () => {
    if (field && !field.value.trim()) { field.focus(); return; }
    ok.disabled = true;
    try { await onConfirm(field?.value.trim()); overlay.remove(); } catch (e) { ok.disabled = false; toast(e.message || '処理に失敗しました'); }
  };
  row.append(cancel, ok);
  modal.append(row);
  overlay.append(modal);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.querySelector('#popupRoot').append(overlay);
  if (field) { field.focus(); field.select(); }
}

async function createChat() {
  const cfg = await getConfig();
  const chat = {
    id: crypto.randomUUID(), title: '新しいチャット', createdAt: Date.now(), updatedAt: Date.now(),
    modelSelection: { provider: cfg.defaultProvider, model: PROVIDERS[cfg.defaultProvider].models[0], autoFallback: cfg.autoFallback },
  };
  const branch = { id: crypto.randomUUID(), chatId: chat.id, title: 'メイン', parentId: null, createdAt: Date.now() };
  chat.activeBranchId = branch.id;
  await put('chats', chat);
  await put('branches', branch);
  return chat;
}
async function ensureChatBranch(chat) {
  let branches = (await getAllByIndex('branches', 'chatId', chat.id)).sort((a, b) => a.createdAt - b.createdAt);
  if (!branches.length) {
    const branch = { id: crypto.randomUUID(), chatId: chat.id, title: 'メイン', parentId: null, createdAt: Date.now() };
    const msgs = (await getAllByIndex('messages', 'chatId', chat.id)).sort((a, b) => a.createdAt - b.createdAt);
    for (const msg of msgs) { if (!msg.branchId) { msg.branchId = branch.id; await put('messages', msg); } }
    await put('branches', branch);
    branches = [branch];
  }
  if (!branches.some(b => b.id === chat.activeBranchId)) { chat.activeBranchId = branches[branches.length - 1].id; await put('chats', chat); }
  return branches;
}
async function refreshBranchSelector(chat) {
  const branches = await ensureChatBranch(chat);
  els.branchSelect.innerHTML = '';
  for (const b of branches) {
    const option = document.createElement('option');
    option.value = b.id; option.textContent = b.title || '分岐';
    els.branchSelect.append(option);
  }
  els.branchSelect.value = chat.activeBranchId;
}
async function refreshChats(selectId) {
  const chats = (await getAll('chats')).sort((a, b) => b.updatedAt - a.updatedAt);
  if (!chats.length) { const c = await createChat(); return refreshChats(c.id); }
  for (const chat of chats) await ensureChatBranch(chat);
  state.chatId = chats.some(c => c.id === selectId) ? selectId : chats[0].id;
  els.select.innerHTML = '';
  els.chatList.innerHTML = '';
  els.chatCount.textContent = String(chats.length);
  for (const c of chats) {
    const opt = document.createElement('option'); opt.value = c.id; opt.textContent = c.title; els.select.append(opt);
    const item = document.createElement('div');
    item.className = 'chat-item' + (c.id === state.chatId ? ' active' : '');
    item.setAttribute('role', 'listitem');
    const title = document.createElement('button');
    title.type = 'button'; title.className = 'chat-item-title'; title.textContent = c.title;
    title.title = c.title; title.onclick = () => refreshChats(c.id);
    const more = document.createElement('button');
    more.type = 'button'; more.className = 'chat-more'; more.textContent = '⋯'; more.title = 'チャットの操作'; more.setAttribute('aria-label', c.title + 'の操作');
    more.onclick = e => { e.stopPropagation(); toggleChatMenu(item, c); };
    item.append(title, more); els.chatList.append(item);
  }
  els.select.value = state.chatId;
  const activeChat = chats.find(c => c.id === state.chatId);
  els.workspaceHeading.textContent = activeChat?.title || '新しいチャット';
  if (activeChat) await refreshBranchSelector(activeChat);
  await renderHistory();
}
function toggleChatMenu(item, chat) {
  const existing = item.querySelector('.chat-context');
  document.querySelectorAll('.chat-context').forEach(n => n.remove());
  if (existing) return;
  const menu = document.createElement('div'); menu.className = 'chat-context';
  const rename = document.createElement('button'); rename.type = 'button'; rename.textContent = '名前を変更';
  rename.onclick = () => { menu.remove(); openModal({ title: 'チャット名を変更', message: '新しい名前を入力してください。', inputValue: chat.title, confirmLabel: '保存', onConfirm: async name => { chat.title = name; chat.updatedAt = Date.now(); await put('chats', chat); await refreshChats(state.chatId); } }); };
  const del = document.createElement('button'); del.type = 'button'; del.className = 'danger'; del.textContent = '削除';
  del.onclick = () => { menu.remove(); openModal({ title: 'チャットを削除しますか？', message: 'この会話と、このチャットに紐づく短期記憶が削除されます。この操作は取り消せません。', confirmLabel: '削除する', danger: true, onConfirm: async () => { await deleteChatCascade(chat.id); if (chat.id === state.chatId) state.chatId = null; await refreshChats(); } }); };
  menu.append(rename, del); item.append(menu);
  const dismiss = e => { if (!menu.contains(e.target) && !item.contains(e.target)) { menu.remove(); document.removeEventListener('pointerdown', dismiss); } };
  setTimeout(() => document.addEventListener('pointerdown', dismiss), 0);
}
async function renderHistory() {
  els.messages.innerHTML = '';
  const chat = await get('chats', state.chatId);
  const msgs = (await getAllByIndex('messages', 'chatId', state.chatId)).filter(m => !chat?.activeBranchId || m.branchId === chat.activeBranchId).sort((a, b) => a.createdAt - b.createdAt);
  for (const m of msgs) appendMessage(m, { live: false });
  els.welcome.hidden = msgs.length > 0;
  scrollBottom();
}
function makeAction(label, action) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'msg-action'; b.textContent = label;
  b.addEventListener('click', action); return b;
}
function addMessageActions(wrap, msg, live) {
  const bar = document.createElement('div'); bar.className = 'msg-actions';
  if (msg.role === 'user') {
    bar.append(makeAction('コピー', () => navigator.clipboard?.writeText(msg.content).then(() => toast('コピーしました')).catch(() => toast('コピーできませんでした'))));
    bar.append(makeAction('編集', () => editUserMessage(msg)));
  } else {
    bar.append(makeAction('再生成', () => regenerateAssistant(msg)));
    bar.append(makeAction('回答をコピー', () => navigator.clipboard?.writeText(msg.content).then(() => toast('コピーしました')).catch(() => toast('コピーできませんでした'))));
    bar.append(makeAction('⋯', () => showAnswerDetails(msg)));
  }
  wrap.append(bar);
}
function appendMessage(msg, { live = false } = {}) {
  els.welcome.hidden = true;
  const wrap = document.createElement('div'); wrap.className = 'msg ' + msg.role; wrap.dataset.messageId = msg.id;
  const bubble = document.createElement('div'); bubble.className = 'bubble';
  if (msg.role === 'user') bubble.textContent = msg.content;
  else {
    const blocks = msg.blocks ?? lseFilter(msg.content).blocks;
    bubble.append(renderBlocks(blocks, { onAsk: live ? b => showAsk(b, sendText) : undefined }));
    if (msg.sources?.length) bubble.append(renderSources(msg.sources));
  }
  wrap.append(bubble); addMessageActions(wrap, msg, live); els.messages.append(wrap); scrollBottom(); return wrap;
}
function startThinking() {
  const wrap = document.createElement('div'); wrap.className = 'msg assistant thinking-message'; wrap.dataset.thinking = 'true';
  const bubble = document.createElement('div'); bubble.className = 'bubble';
  const dots = document.createElement('span'); dots.className = 'thinking-dots'; dots.setAttribute('aria-label', '考え中');
  for (let i = 0; i < 3; i++) dots.append(document.createElement('span'));
  bubble.append(dots); wrap.append(bubble); els.messages.append(wrap); scrollBottom(); return wrap;
}
async function appendStreaming(msg) {
  let wrap = els.messages.querySelector('[data-thinking="true"]');
  if (!wrap) { wrap = document.createElement('div'); wrap.className = 'msg assistant'; els.messages.append(wrap); }
  wrap.removeAttribute('data-thinking');
  let bubble = wrap.querySelector('.bubble');
  if (!bubble) { bubble = document.createElement('div'); bubble.className = 'bubble'; wrap.append(bubble); }
  bubble.replaceChildren();
  const textNode = document.createElement('div'); textNode.className = 'stream-text'; bubble.append(textNode);
  const text = msg.content || '';
  const step = text.length > 6000 ? 24 : text.length > 2500 ? 12 : 5;
  for (let i = 0; i < text.length; i += step) {
    textNode.textContent = text.slice(0, i + step);
    scrollBottom();
    await new Promise(resolve => setTimeout(resolve, 12));
  }
  bubble.replaceChildren(renderBlocks(msg.blocks ?? lseFilter(text).blocks, { onAsk: b => showAsk(b, sendText) }));
  if (msg.sources?.length) bubble.append(renderSources(msg.sources));
  addMessageActions(wrap, msg, true);
  scrollBottom();
}
async function getActiveMessages() {
  const chat = await get('chats', state.chatId);
  return (await getAllByIndex('messages', 'chatId', state.chatId)).filter(m => !chat?.activeBranchId || m.branchId === chat.activeBranchId).sort((a,b) => a.createdAt-b.createdAt);
}
async function forkBranch(chat, sourceMessages, title) {
  const branch = { id: crypto.randomUUID(), chatId: chat.id, title: (title || '分岐') + ' · ' + new Date().toLocaleTimeString('ja-JP', {hour:'2-digit', minute:'2-digit'}), parentId: chat.activeBranchId || null, createdAt: Date.now() };
  await put('branches', branch);
  const idMap = new Map();
  for (const source of sourceMessages) idMap.set(source.id, crypto.randomUUID());
  for (const source of sourceMessages) {
    const clone = { ...source, id: idMap.get(source.id), branchId: branch.id };
    if (clone.parentId && idMap.has(clone.parentId)) clone.parentId = idMap.get(clone.parentId);
    await put('messages', clone);
  }
  chat.activeBranchId = branch.id; chat.updatedAt = Date.now(); await put('chats', chat);
  return { branch, cloned: sourceMessages.map(m => ({ ...m, id: idMap.get(m.id), branchId: branch.id })) };
}
async function editUserMessage(msg) {
  if (state.busy) return;
  const wrap = els.messages.querySelector('[data-message-id="' + msg.id + '"]'); if (!wrap) return;
  const bubble = wrap.querySelector('.bubble'); bubble.replaceChildren();
  const editor = document.createElement('div'); editor.className = 'msg-edit';
  const area = document.createElement('textarea'); area.value = msg.content; area.setAttribute('aria-label', 'メッセージを編集');
  const row = document.createElement('div'); row.className = 'row';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'msg-action'; cancel.textContent = 'キャンセル'; cancel.onclick = () => renderHistory();
  const save = document.createElement('button'); save.type = 'button'; save.className = 'primary'; save.textContent = '編集して再送信';
  save.onclick = async () => {
    const text = area.value.trim(); if (!text) return;
    const chat = await get('chats', state.chatId); const messages = await getActiveMessages(); const index = messages.findIndex(m => m.id === msg.id);
    const prefix = messages.slice(0, index);
    await forkBranch(chat, prefix, '編集');
    els.messages.innerHTML = ''; await renderHistory();
    await sendText(text);
  };
  row.append(cancel, save); editor.append(area, row); bubble.append(editor); area.focus();
}
async function regenerateAssistant(msg) {
  if (state.busy) return;
  const chat = await get('chats', state.chatId); const messages = await getActiveMessages(); const index = messages.findIndex(m => m.id === msg.id);
  if (index < 0) return;
  const userIndex = messages.slice(0, index).map(m => m.role).lastIndexOf('user');
  if (userIndex < 0) return toast('再生成するユーザーメッセージが見つかりません');
  const userMsg = messages[userIndex];
  const prefix = messages.slice(0, userIndex + 1);
  const { cloned } = await forkBranch(chat, prefix, '再生成');
  await refreshBranchSelector(chat); await renderHistory();
  const clonedUser = cloned[cloned.length - 1];
  state.busy = true; state.ctrl = new AbortController(); els.sendBtn.disabled = true; els.stopBtn.hidden = false;
  try {
    await runTurn({ chatId: state.chatId, input: clonedUser.content, existingUserMsgId: clonedUser.id, ui, signal: state.ctrl.signal });
    await refreshChats(state.chatId);
  } catch (e) { toast(e.name === 'AbortError' ? '停止しました' : '再生成エラー: ' + e.message, 6000); await renderHistory().catch(() => {}); }
  finally { state.busy = false; state.ctrl = null; els.sendBtn.disabled = false; els.stopBtn.hidden = true; }
}
async function showAnswerDetails(msg) {
  const overlay = document.createElement('div'); overlay.className = 'overlay';
  const modal = document.createElement('div'); modal.className = 'modal';
  const title = document.createElement('h3'); title.textContent = '回答の詳細';
  const provider = document.createElement('p'); provider.textContent = 'モデル: ' + (msg.provider || '不明');
  const duration = document.createElement('p'); duration.textContent = '回答時間: ' + (typeof msg.durationMs === 'number' ? (msg.durationMs / 1000).toFixed(2) + ' 秒' : '記録なし');
  modal.append(title, provider, duration);
  if (msg.sources?.length) { modal.append(renderSources(msg.sources)); } else { const no = document.createElement('p'); no.className = 'muted'; no.textContent = 'この回答にソース情報はありません。'; modal.append(no); }
  const close = document.createElement('button'); close.type = 'button'; close.className = 'primary'; close.textContent = '閉じる'; close.onclick = () => overlay.remove(); modal.append(close);
  overlay.append(modal); overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); }); document.querySelector('#popupRoot').append(overlay);
}
function scrollBottom() { els.messages.scrollTop = els.messages.scrollHeight; }
async function revertProvider(e) {
  const chat = await get('chats', state.chatId); if (!chat) return;
  chat.modelSelection = { ...chat.modelSelection, provider: e.from, model: PROVIDERS[e.from].models[0] };
  await put('chats', chat); toast(`${PROVIDERS[e.from].label} に戻しました`);
}
async function extractFileText(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (file.size > 15 * 1024 * 1024) throw new Error(file.name + ' は15MBを超えています');
  if (['txt','md','csv','json','js','css','xml','svg','html','htm'].includes(ext) || file.type.startsWith('text/')) {
    const text = await file.text();
    if (['html','htm','svg'].includes(ext)) return new DOMParser().parseFromString(text, 'text/html').body.textContent || text;
    return text;
  }
  if (ext === 'pdf' || file.type === 'application/pdf') {
    const pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    let out = '';
    for (let i = 1; i <= Math.min(pdf.numPages, 80); i++) {
      const page = await pdf.getPage(i); const data = await page.getTextContent();
      out += '\n[Page ' + i + ']\n' + data.items.map(x => x.str || '').join(' ') + '\n';
      if (out.length > 45000) break;
    }
    return out || '(PDFからテキストを抽出できませんでした。スキャン画像PDFの可能性があります)';
  }
  if (['docx'].includes(ext)) {
    const mammoth = await import('https://cdn.jsdelivr.net/npm/mammoth@1.8.0/+esm');
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value;
  }
  if (['xlsx','xls'].includes(ext)) {
    const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    return workbook.SheetNames.map(name => '[Sheet: ' + name + ']\n' + XLSX.utils.sheet_to_csv(workbook.Sheets[name])).join('\n\n');
  }
  if (['pptx'].includes(ext)) {
    const JSZip = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')).default;
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const slides = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort();
    const parts = [];
    for (const name of slides.slice(0, 80)) {
      const xml = await zip.files[name].async('text');
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      parts.push(name + ': ' + Array.from(doc.getElementsByTagName('a:t')).map(n => n.textContent).join(' '));
    }
    return parts.join('\n');
  }
  if (file.type.startsWith('image/')) {
    const Tesseract = await import('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js');
    const result = await Tesseract.recognize(file, 'jpn+eng');
    return '[画像OCR結果]\n' + result.data.text;
  }
  throw new Error(file.name + ' はまだ読み取りに対応していません');
}
async function sendText(text) {
  if (state.busy) return;
  const raw = (text || '').trim();
  const files = state.attachments.splice(0);
  renderAttachments();
  if (!raw && !files.length) return;
  state.busy = true; state.ctrl = new AbortController(); els.sendBtn.disabled = true; els.stopBtn.hidden = false;
  try {
    const chunks = [];
    for (const file of files) {
      try { chunks.push('### 添付ファイル: ' + file.name + '\n' + (await extractFileText(file)).slice(0, 45000)); }
      catch (e) { chunks.push('### 添付ファイル: ' + file.name + '\n読み取りエラー: ' + e.message); }
    }
    const prompt = [raw, chunks.length ? '【添付ファイルの内容】\n' + chunks.join('\n\n').slice(0, 60000) : ''].filter(Boolean).join('\n\n');
    const chat = await get('chats', state.chatId);
    await runTurn({ chatId: state.chatId, input: prompt, ui, signal: state.ctrl.signal });
    await refreshChats(state.chatId);
  } catch (e) {
    if (e.name === 'AbortError') toast('停止しました');
    else { console.error(e); toast('エラー: ' + e.message, 6000); }
    await renderHistory().catch(() => {});
  } finally {
    state.busy = false; state.ctrl = null; els.sendBtn.disabled = false; els.stopBtn.hidden = true;
  }
}
function autosize() { els.input.style.height = 'auto'; els.input.style.height = `${Math.min(els.input.scrollHeight, 160)}px`; }
async function updateSuggest() {
  const m = els.input.value.match(/(?:^|\s)\/([A-Za-z0-9_-]*)$/);
  if (!m) { els.suggest.hidden = true; return; }
  const q = m[1].toLowerCase();
  const list = (await listSkills()).filter(s => s.name.toLowerCase().startsWith(q)).slice(0, 6);
  els.suggest.innerHTML = '';
  if (!list.length) { els.suggest.hidden = true; return; }
  for (const s of list) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = `/${s.name}  ${s.title}`;
    b.onclick = () => { els.input.value = els.input.value.replace(/\/([A-Za-z0-9_-]*)$/, `/${s.name} `); els.suggest.hidden = true; els.input.focus(); };
    els.suggest.append(b);
  }
  els.suggest.hidden = false;
}
function renderAttachments() {
  els.attachmentTray.innerHTML = '';
  els.attachmentTray.hidden = !state.attachments.length;
  for (const file of state.attachments) {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'attachment-card'; card.title = 'タップしてプレビュー';
    const ico = document.createElement('span'); ico.className = 'attachment-icon'; ico.textContent = iconLabel(file);
    const meta = document.createElement('span'); meta.className = 'attachment-meta';
    const name = document.createElement('strong'); name.textContent = file.name;
    const size = document.createElement('small'); size.textContent = formatBytes(file.size);
    meta.append(name, size); card.append(ico, meta);
    card.onclick = () => previewFile(file);
    const remove = document.createElement('span'); remove.className = 'attachment-remove'; remove.textContent = '×'; remove.title = '添付を解除';
    remove.onclick = e => { e.stopPropagation(); state.attachments = state.attachments.filter(f => f !== file); renderAttachments(); };
    card.append(remove); els.attachmentTray.append(card);
  }
}
async function previewFile(file) {
  const overlay = document.createElement('div'); overlay.className = 'overlay';
  const modal = document.createElement('div'); modal.className = 'modal preview-modal';
  const heading = document.createElement('h3'); heading.textContent = file.name;
  const close = document.createElement('button'); close.type = 'button'; close.className = 'icon'; close.textContent = '×'; close.onclick = () => { overlay.remove(); if (modal._url) URL.revokeObjectURL(modal._url); };
  const head = document.createElement('div'); head.className = 'row'; head.style.justifyContent = 'space-between'; head.append(heading, close); modal.append(head);
  const type = file.type || '';
  const ext = file.name.split('.').pop().toLowerCase();
  if (type.startsWith('image/')) {
    const img = document.createElement('img'); img.alt = file.name; img.style.maxWidth = '100%'; img.style.maxHeight = '65vh'; img.style.objectFit = 'contain'; img.style.borderRadius = '12px'; img.src = URL.createObjectURL(file); modal._url = img.src; modal.append(img);
  } else if (type === 'application/pdf' || ext === 'pdf') {
    const frame = document.createElement('iframe'); frame.className = 'preview-frame'; frame.title = file.name; frame.src = URL.createObjectURL(file); modal._url = frame.src; modal.append(frame);
  } else if (['html','htm'].includes(ext)) {
    const frame = document.createElement('iframe'); frame.className = 'preview-frame'; frame.title = file.name; frame.setAttribute('sandbox',''); frame.srcdoc = await file.text(); modal.append(frame);
  } else {
    const content = document.createElement('div'); content.className = 'preview-content';
    if (['txt','md','csv','json','js','css','xml','svg'].includes(ext) || type.startsWith('text/')) content.textContent = await file.text();
    else content.textContent = 'このファイル形式はプレビューに対応していません。ファイル名とサイズは確認できます。';
    modal.append(content);
  }
  overlay.append(modal); overlay.addEventListener('click', e => { if (e.target === overlay) close.click(); });
  document.querySelector('#popupRoot').append(overlay);
}
async function showSkillPicker() {
  els.addMenu.hidden = true;
  const skills = await listSkills();
  const overlay = document.createElement('div'); overlay.className = 'overlay';
  const modal = document.createElement('div'); modal.className = 'modal';
  const title = document.createElement('h3'); title.textContent = 'Skillを追加';
  const desc = document.createElement('p'); desc.textContent = 'チャットで使うSkillを選択します。';
  modal.append(title, desc);
  if (!skills.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'まだSkillがありません。設定から作成できます。'; modal.append(empty); }
  for (const skill of skills) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'options'; b.style.padding = '10px'; b.style.border = '1px solid #e2e8f0'; b.style.borderRadius = '11px'; b.style.background = '#f9fbfd'; b.style.textAlign = 'left'; b.style.cursor = 'pointer';
    b.textContent = `/${skill.name} — ${skill.title}`;
    b.onclick = () => { els.input.value = (els.input.value ? els.input.value + ' ' : '') + `/${skill.name} `; els.input.focus(); autosize(); overlay.remove(); };
    modal.append(b);
  }
  const close = document.createElement('button'); close.type = 'button'; close.className = 'primary'; close.textContent = '閉じる'; close.onclick = () => overlay.remove(); modal.append(close);
  overlay.append(modal); overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); }); document.querySelector('#popupRoot').append(overlay);
}

// ---------- Events ----------
els.form.addEventListener('submit', e => {
  e.preventDefault(); const v = els.input.value; els.input.value = ''; autosize(); els.suggest.hidden = true; els.addMenu.hidden = true;
  sendText(v);
});
els.input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); els.form.requestSubmit(); } });
els.input.addEventListener('input', () => { autosize(); updateSuggest(); });
els.stopBtn.addEventListener('click', () => state.ctrl?.abort());
els.select.addEventListener('change', () => refreshChats(els.select.value));
els.branchSelect.addEventListener('change', async () => { const chat = await get('chats', state.chatId); if (!chat) return; chat.activeBranchId = els.branchSelect.value; await put('chats', chat); await renderHistory(); });
els.newBtn.addEventListener('click', async () => { const c = await createChat(); await refreshChats(c.id); if (isMobile()) setSidebar(false); });
els.delBtn.addEventListener('click', async () => { if (!state.chatId) return; openModal({ title: 'チャットを削除しますか？', message: 'この会話と短期記憶が削除されます。', confirmLabel: '削除する', danger: true, onConfirm: async () => { await deleteChatCascade(state.chatId); await refreshChats(); } }); });
els.setBtn.addEventListener('click', () => openSettings('models'));
els.skillsBtn.addEventListener('click', () => openSettings('skills'));
els.accountBtn.addEventListener('click', () => openSettings('account'));
els.backBtn.addEventListener('click', closeSettings);
els.openSidebar.addEventListener('click', () => setSidebar(true));
els.closeSidebar.addEventListener('click', () => setSidebar(false));
els.scrim.addEventListener('click', () => setSidebar(false));
els.plusButton.addEventListener('click', () => { els.addMenu.hidden = !els.addMenu.hidden; });
els.addSkill.addEventListener('click', showSkillPicker);
els.addFile.addEventListener('click', () => { els.addMenu.hidden = true; els.fileInput.click(); });
els.fileInput.addEventListener('change', () => {
  const incoming = Array.from(els.fileInput.files || []);
  for (const file of incoming) {
    if (state.attachments.some(f => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified)) continue;
    if (state.attachments.length >= 8) { toast('添付は最大8ファイルです'); break; }
    state.attachments.push(file);
  }
  renderAttachments(); els.fileInput.value = '';
});
document.addEventListener('pointerdown', e => {
  if (!els.addMenu.hidden && !els.addMenu.contains(e.target) && !els.plusButton.contains(e.target)) els.addMenu.hidden = true;
  if (isMobile() && state.sidebarOpen && !els.sidebar.contains(e.target) && !els.openSidebar.contains(e.target) && !els.scrim.contains(e.target)) setSidebar(false);
});
els.chatView.addEventListener('click', () => { if (isMobile() && state.sidebarOpen) setSidebar(false); });
document.querySelectorAll('[data-prompt]').forEach(b => b.addEventListener('click', () => { els.input.value = b.dataset.prompt; autosize(); els.input.focus(); }));

window.addEventListener('resize', () => setSidebar(state.sidebarOpen));
async function boot() {
  await openDB();
  const cfg = await getConfig();
  if (cfg.firebaseConfig?.apiKey && cfg.firebaseConfig?.authDomain && cfg.firebaseConfig?.projectId && cfg.firebaseConfig?.appId) {
    try {
      await configureFirebase(cfg.firebaseConfig);
      await observeAuth(user => {
        const name = document.querySelector('#accountName');
        if (name) name.textContent = user ? (user.displayName || user.email || 'LUNA User') : 'LUNA User';
      });
    } catch (e) { console.warn('Firebase initialization:', e.message); }
  }
  await refreshChats();
  setSidebar(!isMobile());
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(e => console.error('SW register failed', e));
}
boot().catch(e => { console.error(e); toast(`起動に失敗しました: ${e.message}`, 8000); });
