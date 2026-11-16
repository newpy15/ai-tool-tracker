// 사용량(5시간·7일 한도, 컨텍스트)을 화면에 보이기 위한 순수 함수 모음. Claude Code 없이 시험할 수 있다 (test/usage.test.mjs).
// 값은 Claude Code가 알려 주는 퍼센트이고, 정확한 토큰 수는 공개되지 않으므로 이 파일도 토큰 수를 만들어 내지 않는다.

export type Level = 'ok' | 'mid' | 'high' | 'full'

/** 퍼센트를 0~100 숫자로 바로잡는다. 숫자가 아니면 undefined */
export const pct = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : undefined

/** 얼마나 찼는지 단계: 60% 미만 여유, 60~80 절반 넘음, 80~95 곧 한도, 95 이상 거의 다 씀 */
export const levelOf = (p: number): Level => (p >= 95 ? 'full' : p >= 80 ? 'high' : p >= 60 ? 'mid' : 'ok')

/** 단계의 화면 색 (테마 이름) */
export const levelColor = (l: Level): 'success' | 'warning' | 'error' =>
  l === 'ok' ? 'success' : l === 'mid' ? 'warning' : 'error'

/** 글자 막대: 예) 32% → ███░░░░░░░ */
export const bar = (p: number, width = 10): string => {
  const n = Math.round((Math.min(100, Math.max(0, p)) / 100) * width)
  return '█'.repeat(n) + '░'.repeat(width - n)
}

/** 초기화까지 남은 시간(시, 분). 시각을 알 수 없으면 undefined, 이미 지났으면 0시간 0분 */
export const untilReset = (iso: unknown, now: number): { h: number; m: number } | undefined => {
  const t = Date.parse(typeof iso === 'string' ? iso : '')
  if (!Number.isFinite(t)) return undefined
  const mins = Math.max(0, Math.ceil((t - now) / 60000))
  return { h: Math.floor(mins / 60), m: mins % 60 }
}

export type Window = { percent: number; resetsAt?: string }

/** 한도 목록에서 한 종류(five_hour, seven_day)를 찾는다. 퍼센트가 숫자가 아니면 없는 것으로 본다 */
export const pickWindow = (list: unknown, kind: string): Window | undefined => {
  if (!Array.isArray(list)) return undefined
  const r = list.find((x: any) => x && x.kind === kind)
  const p = pct(r?.percentUsed)
  return p === undefined ? undefined : { percent: p, resetsAt: typeof r.resetsAt === 'string' ? r.resetsAt : undefined }
}

/** 새 단계에 처음 들어섰을 때만 알리려고 쓴다: 올라가는 방향이고 high 이상일 때 true */
export const shouldWarn = (prev: Level | undefined, next: Level): boolean =>
  (next === 'high' || next === 'full') && prev !== next && (prev === undefined || prev === 'ok' || prev === 'mid' || next === 'full')

/** 사용량 보호: 5시간·7일 중 하나라도 guard% 이상이면 그 창을 돌려준다. 값을 모르면 막지 않는다 */
export const overGuard = (list: unknown, guard: number): { kind: 'five_hour' | 'seven_day'; percent: number } | undefined => {
  for (const kind of ['seven_day', 'five_hour'] as const) {
    const w = pickWindow(list, kind)
    if (w && w.percent >= guard) return { kind, percent: w.percent }
  }
  return undefined
}

export type Cost = { skills: number; agents: number; mcp: number; total: number }

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

/**
 * 대화를 시작할 때 모델에게 미리 올라가는 설명(스킬 목록, 에이전트 설명, MCP 도구 설명)의 토큰을
 * 플러그인별로 모은다. Claude Code가 낸 (어림) 값을 합칠 뿐이고, "이번 작업에서 쓴 양"이 아니다.
 * 스킬은 pluginName, 에이전트는 "<플러그인>:<이름>", MCP는 서버 이름에 든 플러그인 이름으로 짝짓는다.
 * 플러그인에 속하지 않은 내 스킬은 skills에 이름별로 담는다.
 */
export const attribute = (
  bd: any,
  plugins: string[],
): { plugins: Record<string, Cost>; skills: Record<string, number> } => {
  const out: Record<string, Cost> = {}
  const own: Record<string, number> = {}
  const list = (x: unknown): any[] => (Array.isArray(x) ? x : [])
  const skills = list(bd?.skills?.skillFrontmatter)
  const agents = list(bd?.agents)
  const mcp = list(bd?.mcpTools)
  for (const sk of skills) if (!sk?.pluginName && typeof sk?.name === 'string') own[sk.name] = (own[sk.name] ?? 0) + num(sk.tokens)
  for (const n of plugins) {
    const c: Cost = { skills: 0, agents: 0, mcp: 0, total: 0 }
    for (const sk of skills) if (sk?.pluginName === n) c.skills += num(sk.tokens)
    for (const a of agents) if (typeof a?.agentType === 'string' && a.agentType.startsWith(`${n}:`)) c.agents += num(a.tokens)
    for (const t of mcp) {
      if (t?.isLoaded === false || typeof t?.serverName !== 'string') continue
      // 이름 그대로 비교한다: 'remotion'이 'remotion-pro'의 것을 가져가지 않게 구분 글자(: 또는 _)까지 맞춘다
      const sn = t.serverName
      if (sn === n || sn.startsWith(`plugin:${n}:`) || sn.startsWith(`plugin_${n}_`)) c.mcp += num(t.tokens)
    }
    c.total = c.skills + c.agents + c.mcp
    out[n] = c
  }
  return { plugins: out, skills: own }
}
