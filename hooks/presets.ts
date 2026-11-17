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
