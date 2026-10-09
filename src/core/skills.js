// Skills（仕組み章 5.3）
import { get, put, del, getAll, getAllByIndex } from '../store/db.js';

const NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
const MAX_SKILLS_PER_MESSAGE = 3;

export async function listSkills() {
  return (await getAll('skills')).sort((a, b) => a.name.localeCompare(b.name));
}

async function assertUniqueName(name, exceptId) {
  const hit = (await getAllByIndex('skills', 'name', name))[0];
  if (hit && hit.id !== exceptId) throw new Error(`/${name} は既に使われています`);
}

export async function createSkill({ name, title, instruction }) {
  name = (name || '').trim();
  if (!NAME_RE.test(name)) throw new Error('呼び出し名は英数字・_・- の1〜32文字で入力してください');
  if (!instruction?.trim()) throw new Error('指示を入力してください');
  await assertUniqueName(name);
  const now = Date.now();
  const s = {
    id: crypto.randomUUID(),
    name,
    title: (title || name).trim(),
    instruction: instruction.trim(),
    createdAt: now,
    updatedAt: now,
  };
  await put('skills', s);
  return s;
}

export async function updateSkill(id, patch) {
  const s = await get('skills', id);
  if (!s) throw new Error('スキルが見つかりません');
  const next = { ...s, ...patch, updatedAt: Date.now() };
  if (!NAME_RE.test(next.name)) throw new Error('呼び出し名の形式が不正です');
  await assertUniqueName(next.name, id);
  await put('skills', next);
  return next;
}

export const deleteSkill = (id) => del('skills', id);

/**
 * 入力中の /name を展開する。
 * 先頭または空白の直後にある /name（後ろは空白か文末）だけを対象にする。
 */
export function expandSkills(input, skills) {
  const map = new Map(skills.map((s) => [s.name.toLowerCase(), s]));
  const applied = [];
  const unknown = [];
  const re = /(^|\s)\/([A-Za-z0-9_-]{1,32})(?=\s|$)/g;

  const cleaned = input.replace(re, (full, lead, name) => {
    const s = map.get(name.toLowerCase());
    if (!s) {
      unknown.push(name);
      return full;
    }
    if (applied.length >= MAX_SKILLS_PER_MESSAGE) return full;
    if (!applied.includes(s)) applied.push(s);
    return lead;
  });

  return { cleanedInput: cleaned.replace(/[ \t]{2,}/g, ' ').trim(), applied, unknown };
}
