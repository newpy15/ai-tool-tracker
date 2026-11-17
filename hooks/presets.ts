// 목적별 프리셋("영상 작업 모드" 등): 그 일에 맞는 묶음의 플러그인만 켜고 나머지는 끄는 계획을 만든다.
// 계획만 만들고 실제로 켜고 끄는 일은 하지 않는다. Claude Code와 무관하게 시험할 수 있다 (test/presets.test.mjs).
import type { CatKey } from './categories'

export type PresetKey = 'video' | 'docs' | 'web' | 'data'
export const PRESETS: { key: PresetKey; cats: CatKey[] }[] = [
  { key: 'video', cats: ['video', 'captions', 'image'] },
  { key: 'docs', cats: ['planning', 'files', 'marketing'] },
  { key: 'web', cats: ['web', 'dev', 'security'] },
  { key: 'data', cats: ['data', 'dev'] },
]

/** 계획에 쓰는 항목의 최소한: 이름, 묶음, 지금 켜져 있는지, 이 플러그인이 켜고 끌 수 있는 것인지 */
export type PlanItem = { name: string; cat: CatKey; enabled: boolean; toggleable: boolean }
export type Plan = { on: string[]; off: string[]; same: number }

const okName = (n: unknown): n is string => typeof n === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(n)
/** 내 프리셋에 담을 수 있는 이름 수 */
export const MAX_MINE = 100

/**
 * 묶음 프리셋: 고른 묶음의 플러그인은 켜고, 다른 묶음의 플러그인은 끈다.
 * "기타" 묶음은 무엇인지 알 수 없으므로 건드리지 않고, 켜고 끌 수 없는 것도 건드리지 않는다.
 */
export const planByCats = (items: PlanItem[], cats: CatKey[]): Plan => {
  const on: string[] = []
  const off: string[] = []
  let same = 0
  for (const it of items) {
    if (!it.toggleable || it.cat === 'other') continue
    const want = cats.includes(it.cat)
    if (want && !it.enabled) on.push(it.name)
    else if (!want && it.enabled) off.push(it.name)
    else same++
  }
  return { on, off, same }
}

/** 내 프리셋: 저장해 둔 이름은 켜고, 나머지는 끈다 (저장 뒤에 새로 깐 것도 끈다) */
export const planByNames = (items: PlanItem[], names: string[]): Plan => {
  const want = new Set(names)
  const on: string[] = []
  const off: string[] = []
  let same = 0
  for (const it of items) {
    if (!it.toggleable) continue
    const w = want.has(it.name)
    if (w && !it.enabled) on.push(it.name)
    else if (!w && it.enabled) off.push(it.name)
    else same++
  }
  return { on, off, same }
}

/** 지금 켜진 플러그인 이름들 (내 프리셋으로 저장할 값) */
export const enabledNames = (items: PlanItem[]): string[] =>
  items.filter(i => i.toggleable && i.enabled && okName(i.name)).map(i => i.name).slice(0, MAX_MINE)

/** 저장된 값이 어떤 모양이어도 안전한 이름 목록으로 바로잡는다 */
export const parseMine = (raw: unknown): string[] =>
  Array.isArray(raw) ? [...new Set(raw.filter(okName))].slice(0, MAX_MINE) : []

export const isEmptyPlan = (p: Plan): boolean => p.on.length === 0 && p.off.length === 0

// ---------------------------------------------------------------------------
// 내 프리셋: 이름을 붙여 여러 개 저장하고, 고치고, 지울 수 있다
// ---------------------------------------------------------------------------
export type Custom = { id: string; name: string; names: string[] }
/** 만들 수 있는 내 프리셋 수 */
export const MAX_CUSTOM = 6
const okId = (s: unknown): s is string => typeof s === 'string' && /^[a-z0-9]{1,16}$/.test(s)

/** 화면에 보일 이름: 눈속임 글자와 줄바꿈을 없애고 30자까지만 */
export const cleanLabel = (s: unknown): string =>
  String(s ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30)

/** 저장된 값이 어떤 모양이어도 안전한 목록으로 바로잡는다: id 중복, 이름 없음, 너무 많은 것은 버린다 */
export const parseCustom = (raw: unknown): Custom[] => {
  if (!Array.isArray(raw)) return []
  const out: Custom[] = []
  const seen = new Set<string>()
  for (const r of raw) {
    const name = cleanLabel((r as any)?.name)
    if (!okId((r as any)?.id) || seen.has((r as any).id) || !name) continue
    seen.add((r as any).id)
    out.push({ id: (r as any).id, name, names: parseMine((r as any).names) })
    if (out.length >= MAX_CUSTOM) break
  }
  return out
}

/** 예전 버전의 "내 프리셋"(이름 목록 하나)을 새 모양으로 옮긴다 */
export const migrateMine = (old: unknown, label: string): Custom[] => {
  const names = parseMine(old)
  return names.length > 0 ? [{ id: 'u0', name: cleanLabel(label) || 'My preset', names }] : []
}

/** 새로 만든다. 가득 찼거나 id가 겹치거나 이름이 비면 그대로 돌려준다 */
export const addCustom = (list: Custom[], id: string, name: string, names: string[]): Custom[] => {
  const n = cleanLabel(name)
  if (list.length >= MAX_CUSTOM || !okId(id) || list.some(c => c.id === id) || !n) return list
  return [...list, { id, name: n, names: parseMine(names) }]
}

export const renameCustom = (list: Custom[], id: string, name: string): Custom[] => {
  const n = cleanLabel(name)
  return n ? list.map(c => (c.id === id ? { ...c, name: n } : c)) : list
}

export const deleteCustom = (list: Custom[], id: string): Custom[] => list.filter(c => c.id !== id)

/** 플러그인 하나를 넣거나 뺀다 */
export const toggleMember = (list: Custom[], id: string, plugin: string): Custom[] =>
  list.map(c => {
    if (c.id !== id || !okName(plugin)) return c
    const has = c.names.includes(plugin)
    return { ...c, names: has ? c.names.filter(x => x !== plugin) : [...c.names, plugin].slice(0, MAX_MINE) }
  })

/** 담은 플러그인을 통째로 바꾼다 (지금 켜진 것으로 덮어쓰기) */
export const replaceMembers = (list: Custom[], id: string, names: string[]): Custom[] =>
  list.map(c => (c.id === id ? { ...c, names: parseMine(names) } : c))

/** 겹치지 않는 새 id */
export const newId = (list: Custom[], seed: number): string => {
  let n = seed
  let id = `u${n.toString(36)}`
  while (list.some(c => c.id === id)) id = `u${(++n).toString(36)}`
  return id.slice(0, 16)
}
