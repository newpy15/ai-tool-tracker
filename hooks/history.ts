// "안 쓴 플러그인"을 알려 주기 위한 사용 기록. 플러그인 이름과 마지막으로 쓰인 시각, 횟수만 담는다.
// 대화 내용, 파일 경로, 프롬프트는 담지 않는다. Claude Code와 무관하게 시험할 수 있다 (test/history.test.mjs).

export type Entry = { last: number; count: number }
export type History = { since: number; items: Record<string, Entry> }

const DAY = 24 * 60 * 60 * 1000
/** 기록할 수 있는 이름의 최대 개수 (저장 공간이 끝없이 커지지 않게) */
export const MAX_ITEMS = 500
/** 안 쓴 것으로 볼 기간 후보(일) */
export const DAY_OPTIONS = [7, 14, 30]
export const DEFAULT_DAYS = 14

const okName = (n: unknown): n is string => typeof n === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(n)

export const emptyHistory = (now: number): History => ({ since: now, items: {} })

/** 저장된 값이 어떤 모양이어도 안전한 기록으로 바로잡는다. 잘못된 것은 버린다 */
export const parseHistory = (raw: unknown, now: number): History => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as any
  const since = typeof r.since === 'number' && Number.isFinite(r.since) && r.since > 0 && r.since <= now ? r.since : now
  const items: Record<string, Entry> = {}
  const src = r.items && typeof r.items === 'object' ? r.items : {}
  for (const k of Object.keys(src).slice(0, MAX_ITEMS)) {
    const e = src[k]
    if (!okName(k) || !e || typeof e.last !== 'number' || !Number.isFinite(e.last) || e.last <= 0 || e.last > now + DAY) continue
    items[k] = { last: e.last, count: Number.isInteger(e.count) && e.count > 0 ? e.count : 1 }
  }
  return { since, items }
}

/** 한 번 쓰인 것을 기록한다. 이름이 안전하지 않거나 너무 많이 쌓였으면 기록하지 않는다 */
export const record = (h: History, name: string, now: number): History => {
  if (!okName(name)) return h
  const cur = h.items[name]
  if (!cur && Object.keys(h.items).length >= MAX_ITEMS) return h
  return { ...h, items: { ...h.items, [name]: { last: now, count: (cur?.count ?? 0) + 1 } } }
}

/** 다른 세션이 저장해 둔 기록과 합친다: 시작은 더 이른 쪽, 마지막 사용은 더 늦은 쪽, 횟수는 더 큰 쪽 */
export const merge = (a: History, b: History): History => {
  const items: Record<string, Entry> = { ...a.items }
  for (const [k, e] of Object.entries(b.items)) {
    const x = items[k]
    items[k] = x ? { last: Math.max(x.last, e.last), count: Math.max(x.count, e.count) } : e
  }
  return { since: Math.min(a.since, b.since), items }
}

export const daysBetween = (from: number, now: number): number => Math.max(0, Math.floor((now - from) / DAY))

export type Unused = { name: string; lastDays?: number }

/**
 * 안 쓴 플러그인 목록. 기록을 모은 지 days일이 안 됐으면 ready=false로, 아직 판단하지 않는다
 * (기록이 없어서 "안 쓴 것"처럼 보이는 것을 막으려고). 목록은 오래 안 쓴 순이고, 한 번도 기록이 없으면 lastDays가 없다.
 */
export const unusedList = (
  h: History,
  names: string[],
  now: number,
  days: number,
): { ready: boolean; trackedDays: number; list: Unused[] } => {
  const trackedDays = daysBetween(h.since, now)
  if (trackedDays < days) return { ready: false, trackedDays, list: [] }
  const list: Unused[] = []
  for (const name of names) {
    const e = h.items[name]
    if (!e) list.push({ name })
    else if (now - e.last >= days * DAY) list.push({ name, lastDays: daysBetween(e.last, now) })
  }
  // 한 번도 안 쓴 것을 앞에, 그다음 오래 안 쓴 순
  list.sort((x, y) => (x.lastDays ?? Infinity) === (y.lastDays ?? Infinity) ? x.name.localeCompare(y.name) : (y.lastDays ?? Infinity) - (x.lastDays ?? Infinity))
  return { ready: true, trackedDays, list }
}
