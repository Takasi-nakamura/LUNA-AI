// 設定画面（仕組み章 4.6 / 5.3 / 6）
import { el, button, input, checkbox, labeled } from './dom.js';
import { getAll } from '../store/db.js';
import { getConfig, patchConfig } from '../store/config.js';
import { PROVIDERS } from '../core/router.js';
import { listSkills, createSkill, updateSkill, deleteSkill } from '../core/skills.js';
import { updateMemory, deleteMemory, updateShort, deleteShort, promote } from '../core/memory.js';
import { toast } from './popups.js';

export function renderSettings(root) {
  root.innerHTML = '';
  const tabs = el('div', 'tabs');
  const body = el('div', 'tab-body');
  const panels = { models: modelsPanel, memory: memoryPanel, skills: skillsPanel };
  const labels = { models: 'モデル', memory: '記憶', skills: 'スキル' };
  const btns = {};

  const show = async (key) => {
    for (const k of Object.keys(btns)) btns[k].classList.toggle('active', k === key);
    body.replaceChildren(await panels[key](() => show(key)));
  };

  for (const k of Object.keys(panels)) {
    const b = button(labels[k], () => show(k), 'tab');
    btns[k] = b;
    tabs.append(b);
  }
  root.append(tabs, body);
  show('models');
}

// ---------- モデル ----------
async function modelsPanel() {
  const cfg = await getConfig();
  const panel = el('div', 'panel');
  const provInputs = {};

  for (const [id, p] of Object.entries(PROVIDERS)) {
    const card = el('div', 'card');
    card.append(el('h3', '', `${p.label}（${p.models[0]}）`));
    const key = input(cfg.providers[id].apiKey, 'password');
    key.placeholder = 'APIキー';
    key.autocomplete = 'off';
    const en = checkbox(cfg.providers[id].enabled);
    card.append(labeled('APIキー', key), labeled('有効', en));
    provInputs[id] = { key, en };
    panel.append(card);
  }

  const card = el('div', 'card');
  card.append(el('h3', '', '全体設定'));
  const auto = checkbox(cfg.autoFallback);
  const def = document.createElement('select');
  for (const id of Object.keys(PROVIDERS)) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = PROVIDERS[id].label;
    def.append(o);
  }
  def.value = cfg.defaultProvider;
  const search = input(cfg.searchApiKey, 'password');
  search.placeholder = 'Tavily APIキー（Web検索）';
  const inj = checkbox(cfg.memoryInjection);
  card.append(
    labeled('制限時に自動切替', auto),
    labeled('既定のプロバイダ', def),
    labeled('Web検索キー', search),
    labeled('記憶の自動提示', inj)
  );

  const save = button('保存', async () => {
    await patchConfig((c) => {
      for (const id of Object.keys(PROVIDERS)) {
        c.providers[id] = { apiKey: provInputs[id].key.value.trim(), enabled: provInputs[id].en.checked };
      }
      c.autoFallback = auto.checked;
      c.defaultProvider = def.value;
      c.searchApiKey = search.value.trim();
      c.memoryInjection = inj.checked;
    });
    toast('保存しました');
  }, 'primary');

  panel.append(card, save);
  return panel;
}

// ---------- 記憶 ----------
async function memoryPanel(reload) {
  const panel = el('div', 'panel');
  const longs = (await getAll('memory')).sort((a, b) => b.updatedAt - a.updatedAt);
  const shorts = (await getAll('shortTerm')).sort((a, b) => b.updatedAt - a.updatedAt);
  const chatTitles = new Map((await getAll('chats')).map((c) => [c.id, c.title]));

  panel.append(el('h3', '', '長期記憶（全チャット共通）'));
  if (!longs.length) panel.append(el('p', 'muted', 'まだありません'));
  for (const m of longs) panel.append(memoryCard(m, 'long', reload, chatTitles));

  panel.append(el('h3', '', '会話短期記憶（チャット限定）'));
  if (!shorts.length) panel.append(el('p', 'muted', 'まだありません'));
  for (const s of shorts) panel.append(memoryCard(s, 'short', reload, chatTitles));
  return panel;
}

function memoryCard(m, scope, reload, chatTitles) {
  const card = el('div', 'card');
  const content = document.createElement('textarea');
  content.value = m.content;
  content.rows = 3;
  const kw = input(m.keywords.join(', '));
  const enabled = checkbox(m.enabled !== false);

  const meta = scope === 'long'
    ? el('div', 'muted', `提示 ${m.injectCount || 0}回`)
    : el('div', 'muted', `チャット：${chatTitles.get(m.chatId) ?? '（削除済み）'}`);

  card.append(labeled('内容', content), labeled('キーワード（カンマ区切り）', kw), meta);
  if (scope === 'long') card.append(labeled('有効', enabled));

  const row = el('div', 'row');
  row.append(
    button('保存', async () => {
      const patch = { content: content.value.trim(), keywords: kw.value.split(/[,、]/) };
      if (scope === 'long') {
        patch.enabled = enabled.checked;
        await updateMemory(m.id, patch);
      } else {
        await updateShort(m.id, patch);
      }
      toast('保存しました');
    }, 'primary'),
    button('削除', async () => {
      if (!confirm('削除しますか？')) return;
      if (scope === 'long') await deleteMemory(m.id);
      else await deleteShort(m.id);
      reload();
    })
  );
  if (scope === 'short') {
    row.append(button('長期記憶へ昇格', async () => {
      await promote(m.id);
      toast('長期記憶に昇格しました');
      reload();
    }));
  }
  card.append(row);
  return card;
}

// ---------- スキル ----------
async function skillsPanel(reload) {
  const panel = el('div', 'panel');
  panel.append(el('p', 'muted', 'チャットで /名前 と入力すると、この指示が適用されます。'));
  panel.append(skillEditor(null, reload));
  for (const s of await listSkills()) panel.append(skillEditor(s, reload));
  return panel;
}

function skillEditor(s, reload) {
  const card = el('div', 'card');
  card.append(el('h3', '', s ? `/${s.name}` : '新規スキル'));
  const name = input(s?.name ?? '');
  name.placeholder = '呼び出し名（英数字_-）';
  const title = input(s?.title ?? '');
  title.placeholder = '表示名';
  const instr = document.createElement('textarea');
  instr.rows = 4;
  instr.value = s?.instruction ?? '';
  card.append(labeled('呼び出し名', name), labeled('タイトル', title), labeled('指示', instr));

  const row = el('div', 'row');
  row.append(button(s ? '更新' : '作成', async () => {
    try {
      const data = { name: name.value.trim(), title: title.value.trim(), instruction: instr.value.trim() };
      if (s) await updateSkill(s.id, data);
      else await createSkill(data);
      toast('保存しました');
      reload();
    } catch (e) {
      toast(e.message, 4000);
    }
  }, 'primary'));
  if (s) {
    row.append(button('削除', async () => {
      if (!confirm('削除しますか？')) return;
      await deleteSkill(s.id);
      reload();
    }));
  }
  card.append(row);
  return card;
}
