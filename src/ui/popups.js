import { el, button, input } from './dom.js';

export function toast(msg, ms = 2600) {
  const t = el('div', 'toast', msg);
  document.querySelector('#toastRoot').append(t);
  setTimeout(() => t.remove(), ms);
}

function openModal(parts) {
  const ov = el('div', 'overlay');
  const box = el('div', 'modal');
  box.append(...parts);
  ov.append(box);
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  document.querySelector('#popupRoot').append(ov);
  return close;
}

// プロバイダ自動切替の通知（仕組み章 7）
export function showSwitch(e, onRevert) {
  let close;
  const row = el('div', 'row');
  row.append(
    button('戻す', async () => { close(); await onRevert(); }, 'primary'),
    button('閉じる', () => close())
  );
  close = openModal([el('h3', '', 'モデルを切り替えました'), el('p', '', e.message), row]);
}

// 質問ポップアップ（ChatGPT連携部分のみ）
export function showAsk(b, onAnswer) {
  let close;
  const answer = (text) => { close(); onAnswer(text); };
  const parts = [el('h3', '', 'LUNAからの質問'), el('p', '', b.question)];

  if (b.options?.length) {
    const opts = el('div', 'options');
    for (const o of b.options) opts.append(button(o, () => answer(o)));
    parts.push(opts);
  }
  if (b.allowFreeText) {
    const i = input('');
    i.placeholder = '自由入力';
    const send = button('送信', () => { if (i.value.trim()) answer(i.value.trim()); }, 'primary');
    const row = el('div', 'row');
    row.append(i, send);
    parts.push(row);
  }
  close = openModal(parts);
}
