// Block[] → DOM（仕組み章 1.2 / 3.3）
import { el, button } from './dom.js';

let _md = null;
const getMd = () => (_md ??= window.markdownit({ html: false, linkify: true, breaks: true }));

export function renderMarkdown(text) {
  const div = el('div', 'md');
  if (!window.markdownit || !window.DOMPurify) {
    div.textContent = text; // CDN読込失敗時はプレーンテキスト
    return div;
  }
  div.innerHTML = window.DOMPurify.sanitize(getMd().render(text));
  div.querySelectorAll('a').forEach((a) => {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  });
  return div;
}

export function renderBlocks(blocks, { onAsk } = {}) {
  const wrap = el('div', 'blocks');
  for (const b of blocks) {
    switch (b.type) {
      case 'markdown': wrap.append(renderMarkdown(b.text)); break;
      case 'code': wrap.append(renderCode(b)); break;
      case 'table': wrap.append(renderTable(b)); break;
      case 'mindmap': wrap.append(renderMindmap(b.root)); break;
      case 'stepcard': wrap.append(renderSteps(b)); break;
      case 'ask': onAsk?.(b); break; // 質問ポップアップ（ChatGPT連携用）
    }
  }
  return wrap;
}

function renderCode(b) {
  const box = el('div', 'codebox');
  box.append(el('div', 'code-cap', b.filename || b.lang));
  const pre = el('pre', 'code');
  pre.append(el('code', '', b.code));
  box.append(pre);
  box.append(button('コピー', () => navigator.clipboard?.writeText(b.code), 'copy'));
  return box;
}

function renderTable(b) {
  const t = el('table');
  const thead = el('thead');
  const hr = el('tr');
  b.headers.forEach((h) => hr.append(el('th', '', h)));
  thead.append(hr);
  const tbody = el('tbody');
  for (const r of b.rows) {
    const tr = el('tr');
    r.forEach((c) => tr.append(el('td', '', c)));
    tbody.append(tr);
  }
  t.append(thead, tbody);
  const wrap = el('div', 'md');
  wrap.append(t);
  return wrap;
}

function mmNode(n) {
  const li = el('li');
  li.append(el('span', 'mm-label', n.label));
  if (n.children?.length) {
    const ul = el('ul');
    for (const c of n.children) ul.append(mmNode(c));
    li.append(ul);
  }
  return li;
}

function renderMindmap(root) {
  const wrap = el('div', 'mindmap');
  const ul = el('ul', 'mm-root');
  ul.append(mmNode(root));
  wrap.append(ul);
  return wrap;
}

function renderSteps(b) {
  const card = el('div', 'stepcard');
  card.append(el('div', 'step-title', b.title));
  for (const s of b.steps) {
    const row = el('div', 'step');
    row.append(el('div', 'step-num', String(s.index)));
    const body = el('div', 'step-body');
    body.append(el('strong', '', s.title));
    if (s.body) body.append(el('div', '', s.body));
    row.append(body);
    card.append(row);
  }
  return card;
}

export function renderSources(sources) {
  const box = el('div', 'sources');
  box.append(el('div', 'sources-title', 'ソース'));
  sources.forEach((s, i) => {
    const a = el('a', '', `[${i + 1}] ${s.title || s.url}`);
    a.href = s.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    box.append(a);
  });
  return box;
}
