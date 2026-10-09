// LUNA SUPER ENGINE フィルター（仕組み章 3.2 / 3.3）
// APIモデルの生テキストを Block[] に分解する。未知・不正なディレクティブは markdown/code にフォールバック。

export function lseFilter(raw = '') {
  const blocks = [];
  const re = /```([\w:-]*)[ \t]*\n([\s\S]*?)```/g;
  const pushText = (t) => {
    const s = t.trim();
    if (s) blocks.push({ type: 'markdown', text: s });
  };

  let last = 0;
  let m;
  while ((m = re.exec(raw))) {
    pushText(raw.slice(last, m.index));
    const lang = m[1];
    const body = m[2];
    if (lang === 'luna:mindmap') {
      blocks.push({ type: 'mindmap', root: parseMindmap(body) });
    } else if (lang === 'luna:steps') {
      blocks.push(...parseSteps(body));
    } else if (lang === 'luna:ask') {
      const ask = parseAsk(body);
      blocks.push(ask ?? { type: 'code', lang: 'json', code: body });
    } else {
      blocks.push({ type: 'code', lang: lang || 'text', code: body.replace(/\n$/, '') });
    }
    last = re.lastIndex;
  }
  pushText(raw.slice(last));
  return { blocks };
}

// インデント2スペース単位で親子を判定する箇条書き
function parseMindmap(body) {
  const root = { label: '', children: [] };
  const stack = [{ indent: -1, node: root }];
  for (const line of body.split('\n')) {
    const m = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    const node = { label: m[2].trim(), children: [] };
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    stack[stack.length - 1].node.children.push(node);
    stack.push({ indent, node });
  }
  const top = root.children;
  return top.length === 1 ? top[0] : { label: 'マインドマップ', children: top };
}

// 「# タイトル」「番号. 見出し :: 本文」形式。前置きは markdown ブロックにする
function parseSteps(body) {
  let title = '手順';
  const steps = [];
  const intro = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.match(/^#\s+(.+)$/);
    if (h) { title = h[1].trim(); continue; }
    const s = line.match(/^(\d+)\.\s+(.+?)\s*::\s*(.*)$/);
    if (s) { steps.push({ index: Number(s[1]), title: s[2].trim(), body: s[3].trim() }); continue; }
    if (steps.length) steps[steps.length - 1].body += ` ${line}`;
    else intro.push(line);
  }
  const out = [];
  if (intro.length) out.push({ type: 'markdown', text: intro.join('\n') });
  out.push({ type: 'stepcard', title, steps });
  return out;
}

function parseAsk(body) {
  try {
    const o = JSON.parse(body);
    if (typeof o.question !== 'string') return null;
    return {
      type: 'ask',
      question: o.question,
      options: Array.isArray(o.options) ? o.options.map(String).slice(0, 4) : undefined,
      allowFreeText: o.allowFreeText !== false,
    };
  } catch {
    return null;
  }
}
