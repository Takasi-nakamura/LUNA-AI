export function el(tag, cls = '', text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export function labeled(label, control) {
  const l = el('label', 'field');
  l.append(el('span', 'field-label', label), control);
  return l;
}

export function button(label, onClick, cls = '') {
  const b = el('button', cls, label);
  b.type = 'button';
  b.onclick = onClick;
  return b;
}

export function input(value = '', type = 'text') {
  const i = document.createElement('input');
  i.type = type;
  i.value = value;
  return i;
}

export function checkbox(checked) {
  const c = document.createElement('input');
  c.type = 'checkbox';
  c.checked = !!checked;
  return c;
}
