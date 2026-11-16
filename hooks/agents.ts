// 용도별 묶음(영상, 자막 등)마다 전용 서브에이전트를 만들 때 쓰는 순수 함수 모음.
// Claude Code와 무관하게 단독으로 시험할 수 있다 (test/agents.test.mjs).
//
// 원칙: 플러그인 이름·설명은 "남이 쓴 글"이다. 에이전트의 설명과 지침에는
//  - 우리가 적은 묶음 이름과 안전 검사를 통과한 플러그인 이름만 넣고, 남이 쓴 설명 글은 넣지 않는다.

// 다른 파일에서 값을 불러오지 않는다(타입만): 시험이 Node에서 이 파일을 그대로 불러올 수 있게 하려고.
// 아래 AGENT_CATS와 okName은 categories.ts, trust.ts와 같아야 하며 시험이 같은지 확인한다.
import type { CatKey } from './categories'

/** 모델: 별칭(haiku 등), 모델 ID, 또는 inherit(지금 모델 그대로) */
export type AgentModel = string
/** 고르기 버튼으로 돌려 보는 모델 (별칭은 그 계열의 최신, ID는 정확한 버전). 다른 것은 직접 입력한다 */
export const MODEL_PRESETS: string[] = [
  'inherit', 'haiku', 'sonnet', 'opus',
  'claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-2',
]
const MODEL_LABELS: Record<string, string> = {
  haiku: 'Haiku (latest)', sonnet: 'Sonnet (latest)', opus: 'Opus (latest)',
  'claude-haiku-5-5': 'Haiku 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5',
  'claude-opus-5-5': 'Opus 5.5', 'claude-fable-5-2': 'Fable 5.2',
}
/** 화면에 보일 모델 이름. 모르는 ID는 그대로 보인다 */
export const modelLabel = (m: string): string => MODEL_LABELS[m] ?? m
export const MAX_BUDGET = 100_000_000
export const MAX_TURNS = 200

export type Range = { min: number; def: number; max: number }
export type Limits = { budget: Range; turns: Range }
/**
 * 모델마다 정한 기본값·최소·최대. 하위 에이전트는 시작만 해도 약 6만 토큰(기본 지침과 도구 목록)이 들기 때문에
 * 최소 한도는 10만 토큰으로 두어 한 번 실행에 한도가 바닥나지 않게 한다.
 * 기본값은 초보자가 기준을 모르는 점을 감안해 일부러 빠듯하게(2~3번 실행 분량) 잡았고, 필요하면 올린다. 비싼 모델일수록 최대를 낮게 잡는다.
 * 0(제한 없음)은 받지 않는다.
 */
export const limitsOf = (model: string): Limits => {
  const m = model.toLowerCase()
  if (m.includes('haiku')) return { budget: { min: 100_000, def: 200_000, max: 3_000_000 }, turns: { min: 3, def: 15, max: 100 } }
  if (m.includes('sonnet')) return { budget: { min: 100_000, def: 150_000, max: 2_000_000 }, turns: { min: 3, def: 12, max: 60 } }
  if (m.includes('opus') || m.includes('fable'))
    return { budget: { min: 100_000, def: 100_000, max: 1_000_000 }, turns: { min: 3, def: 10, max: 40 } }
  // 현재 모델 그대로(inherit)이거나 모르는 모델: 가장 조심스러운 범위
  return { budget: { min: 100_000, def: 100_000, max: 1_000_000 }, turns: { min: 3, def: 10, max: 40 } }
}

/** 범위 안으로 맞춘다. 맞추느라 바뀌었으면 adjusted */
export const fit = (n: number, r: Range): { value: number; adjusted: boolean } => {
  const value = Math.min(r.max, Math.max(r.min, n))
  return { value, adjusted: value !== n }
}

/** 모델을 바꾼다. 한도·턴이 이전 모델의 기본값이었거나 새 범위를 벗어나면 새 모델의 기본값으로, 아니면 그대로 둔다 */
export const changeModel = (cfg: AgentCfg, model: string): AgentCfg => {
  const was = limitsOf(cfg.model)
  const now = limitsOf(model)
  const pick = (cur: number, oldR: Range, newR: Range) =>
    cur === oldR.def || cur < newR.min || cur > newR.max ? newR.def : cur
  return { model, budget: pick(cfg.budget, was.budget, now.budget), maxTurns: pick(cfg.maxTurns, was.turns, now.turns) }
}

/** 모델 ID로 써도 안전한 글자만: 아니면 undefined */
export const parseModel = (t: unknown): string | undefined => {
  const s = (typeof t === 'string' ? t : '').trim()
  return /^[A-Za-z0-9][A-Za-z0-9._:\-]{0,79}$/.test(s) ? s : undefined
}

/** 토큰 수 입력: 200000, 150k, 1.5m, 0(제한 없음). 알아볼 수 없으면 undefined */
export const parseTokens = (t: unknown): number | undefined => {
  const m = /^(\d+(?:\.\d+)?)\s*([km]?)$/i.exec((typeof t === 'string' ? t : '').trim().replace(/,/g, ''))
  if (!m) return undefined
  const n = Math.round(parseFloat(m[1]) * (m[2].toLowerCase() === 'm' ? 1_000_000 : m[2].toLowerCase() === 'k' ? 1000 : 1))
  return Number.isFinite(n) && n >= 0 && n <= MAX_BUDGET ? n : undefined
}

/** 최대 턴 입력: 1부터 MAX_TURNS까지의 정수 */
export const parseTurns = (t: unknown): number | undefined => {
  const s = (typeof t === 'string' ? t : '').trim()
  if (!/^\d{1,3}$/.test(s)) return undefined
  const n = parseInt(s, 10)
  return n >= 1 && n <= MAX_TURNS ? n : undefined
}

export type AgentCfg = { model: AgentModel; budget: number; maxTurns: number }
export type AgentSettings = { on: boolean; guard5: number; guard7: number; cats: Partial<Record<CatKey, AgentCfg>> }
export type AgentUse = Record<string, { runs: number; tokens: number }>

export const DEFAULT_CFG: AgentCfg = { model: 'inherit', budget: 100_000, maxTurns: 10 } // limitsOf('inherit')의 기본값과 같다(시험이 확인)
/**
 * 사용량 보호: 5시간 기준과 주간(7일) 기준을 따로 고른다. 사용량이 그 퍼센트 이상이면 새 하위 에이전트를 시작하지 않는다.
 * 0은 그 기준을 쓰지 않는다는 뜻이다. 둘 다 끌 수는 없다(하나는 반드시 켜져 있다).
 */
export const GUARDS = [0, 50, 60, 70, 80, 90]
export const DEFAULT_GUARD = 80

/** 다음 값으로 돌린다. 다른 기준이 꺼져 있으면 0(끔)은 건너뛴다: 둘 다 꺼지지 않게 */
export const nextGuard = (cur: number, other: number): number => {
  const nx = cycle(GUARDS, cur)
  return nx === 0 && other === 0 ? cycle(GUARDS, 0) : nx
}
/** 한 번의 요청(프롬프트)에서 시작할 수 있는 하위 에이전트 수. 한꺼번에 여러 개 띄워 한도를 넘기는 것을 막는다 */
export const MAX_SPAWNS_PER_PROMPT = 4
export const DEFAULT_SETTINGS: AgentSettings = { on: false, guard5: DEFAULT_GUARD, guard7: DEFAULT_GUARD, cats: {} }
export const PLUGIN_ID = 'ai-tool-tracker'

/** 에이전트를 만들 수 있는 묶음 ("기타"는 하나로 묶을 일이 없어 뺀다) */
export const AGENT_CATS: CatKey[] = [
  'video', 'captions', 'image', 'planning', 'web', 'dev', 'data', 'security', 'files', 'marketing',
]

/** trust.ts의 safeName과 같은 규칙 */
const okName = (n: unknown): string => {
  const s = typeof n === 'string' ? n : ''
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(s) ? s : ''
}

const isCat = (c: unknown): c is CatKey => typeof c === 'string' && (AGENT_CATS as string[]).includes(c)

/** 저장된 값이 어떤 모양이어도 안전한 설정으로 바로잡는다 */
export const parseSettings = (raw: unknown): AgentSettings => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as any
  const cats: AgentSettings['cats'] = {}
  const src = r.cats && typeof r.cats === 'object' ? r.cats : {}
  for (const k of Object.keys(src)) {
    if (!isCat(k)) continue
    const c = src[k] ?? {}
    const model = parseModel(c.model) ?? DEFAULT_CFG.model
    const lim = limitsOf(model)
    const ok = (v: unknown, r: Range) => Number.isInteger(v) && (v as number) >= r.min && (v as number) <= r.max
    cats[k] = {
      model,
      budget: ok(c.budget, lim.budget) ? c.budget : lim.budget.def,
      maxTurns: ok(c.maxTurns, lim.turns) ? c.maxTurns : lim.turns.def,
    }
  }
  // 예전 버전은 기준이 하나(guard)였다: 둘에 같은 값을 쓴다
  const legacy = GUARDS.includes(r.guard) && r.guard > 0 ? r.guard : DEFAULT_GUARD
  let guard5 = GUARDS.includes(r.guard5) ? r.guard5 : legacy
  const guard7 = GUARDS.includes(r.guard7) ? r.guard7 : legacy
  if (guard5 === 0 && guard7 === 0) guard5 = DEFAULT_GUARD // 둘 다 꺼진 채로는 저장하지 않는다
  return { on: r.on === true, guard5, guard7, cats }
}

export const cfgOf = (s: AgentSettings, cat: CatKey): AgentCfg => s.cats[cat] ?? DEFAULT_CFG

/** 목록에서 다음 값 (끝에서 처음으로 돌아온다) */
export const cycle = <T,>(list: readonly T[], cur: T): T => list[(list.indexOf(cur) + 1) % list.length] ?? list[0]

/** 에이전트 종류의 전체 이름: <플러그인>:<묶음> */
export const typeOf = (cat: CatKey): string => `${PLUGIN_ID}:${cat}`

/** 에이전트 종류 이름에서 묶음을 알아낸다. 우리 것이 아니면 undefined */
export const catOfType = (t: unknown): CatKey | undefined => {
  const s = typeof t === 'string' ? t : ''
  if (!s.startsWith(`${PLUGIN_ID}:`)) return undefined
  const c = s.slice(PLUGIN_ID.length + 1)
  return isCat(c) ? c : undefined
}

/**
 * 지금까지 쓴 토큰(근사치): 새로 읽은 입력 + 출력 + 캐시에 쓴 입력 + 캐시에서 읽은 입력의 10%.
 * 캐시에서 읽은 것은 값이 싸지만 하위 에이전트는 턴마다 그것을 다시 읽으므로, 빼 버리면 실제보다 훨씬 적게 센다.
 * 10%는 값 비율에 따른 어림이며, 사용량 한도가 정확히 그렇게 세는 것은 아니다.
 */
export const tokensOf = (u: {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}): number =>
  (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + Math.round((u.cache_read_input_tokens ?? 0) * 0.1)

export const addUsage = (prev: AgentUse, cat: CatKey, tokens: number, runs = 0): AgentUse => {
  const cur = prev[cat] ?? { runs: 0, tokens: 0 }
  return { ...prev, [cat]: { runs: cur.runs + runs, tokens: cur.tokens + Math.max(0, Math.floor(tokens) || 0) } }
}

/** 한도가 있고(0이 아니고) 이미 다 썼으면 true. 새 하위 에이전트를 시작하지 않는다 */
export const isOver = (used: number, budget: number): boolean => budget > 0 && used >= budget

/** 짧은 토큰 표기: 1,200 → 1.2k */
export const fmtTokens = (n: number): string =>
  n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(n)

export type Member = { name: string; kind: 'plugin' | 'skill' }

/** 묶음 전용 에이전트 정의. 이름은 안전한 것만, 최대 12개까지 */
export const buildSpec = (cat: CatKey, label: string, members: Member[], cfg: AgentCfg) => {
  const names = [...new Set(members.map(m => okName(m.name)).filter(Boolean))].slice(0, 12)
  const list = names.join(', ')
  const safeLabel = label.replace(/[^\p{L}\p{N} ·&/()-]/gu, '').slice(0, 40) || cat
  return {
    name: cat,
    description:
      `Hand off ${safeLabel} (${cat}) work here: tasks that fit these installed tools: ${list}. ` +
      `It runs on its own model and token budget so the main conversation stays small.`,
    prompt:
      `You are a focused helper for "${safeLabel}" work inside a larger project. ` +
      `Do only the task you are given, using the installed tools that fit it (${list}). ` +
      `Prefer those tools over writing everything by hand. Keep your final report short: what you did, ` +
      `which files you created or changed, and anything the caller must decide.`,
    model: cfg.model,
    maxTurns: cfg.maxTurns,
  }
}
