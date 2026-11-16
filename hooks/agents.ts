// 용도별 묶음(영상, 자막 등)마다 전용 서브에이전트를 만들 때 쓰는 순수 함수 모음.
// Claude Code와 무관하게 단독으로 시험할 수 있다 (test/agents.test.mjs).
//
// 원칙: 플러그인 이름·설명은 "남이 쓴 글"이다. 에이전트의 설명과 지침에는
//  - 우리가 적은 묶음 이름과 안전 검사를 통과한 플러그인 이름만 넣고, 남이 쓴 설명 글은 넣지 않는다.

// 다른 파일에서 값을 불러오지 않는다(타입만): 시험이 Node에서 이 파일을 그대로 불러올 수 있게 하려고.
// 아래 AGENT_CATS와 okName은 categories.ts, trust.ts와 같아야 하며 시험이 같은지 확인한다.
import type { CatKey } from './categories'

export type AgentModel = 'inherit' | 'haiku' | 'sonnet' | 'opus'
export const AGENT_MODELS: AgentModel[] = ['inherit', 'haiku', 'sonnet', 'opus']
/** 묶음마다 쓸 수 있는 토큰 한도 후보 (0 = 제한 없음) */
export const BUDGETS = [0, 50_000, 200_000, 1_000_000]
/** 하위 에이전트 한 번이 돌 수 있는 최대 턴 후보 */
export const TURN_LIMITS = [10, 20, 40]

export type AgentCfg = { model: AgentModel; budget: number; maxTurns: number }
export type AgentSettings = { on: boolean; cats: Partial<Record<CatKey, AgentCfg>> }
export type AgentUse = Record<string, { runs: number; tokens: number }>

export const DEFAULT_CFG: AgentCfg = { model: 'inherit', budget: 200_000, maxTurns: 20 }
export const DEFAULT_SETTINGS: AgentSettings = { on: false, cats: {} }
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
    cats[k] = {
      model: AGENT_MODELS.includes(c.model) ? c.model : DEFAULT_CFG.model,
      budget: BUDGETS.includes(c.budget) ? c.budget : DEFAULT_CFG.budget,
      maxTurns: TURN_LIMITS.includes(c.maxTurns) ? c.maxTurns : DEFAULT_CFG.maxTurns,
    }
  }
  return { on: r.on === true, cats }
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

/** 지금까지 쓴 토큰: 새로 읽은 입력 + 출력 + 캐시에 쓴 입력 (캐시에서 읽은 것은 싸서 뺀다) */
export const tokensOf = (u: {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
}): number => (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)

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
