// 추천 결과를 믿어도 되는지 가늠하고, 남이 쓴 글자를 안전하게 다루는 순수 함수 모음.
// 이 파일은 Claude Code와 무관하게 단독으로 시험할 수 있다 (test/trust.test.mjs).
//
// 원칙: 목록의 이름·설명·주소는 모두 "남이 쓴 글"이다.
//  - 화면에 찍을 때는 눈속임 글자를 없앤다 (clean)
//  - 명령으로 만들 때는 허용한 글자만 통과시킨다 (safeName, safeRepo)
//  - 링크는 주소를 믿지 않고, 검증한 owner/repo로 github.com 주소를 직접 만든다 (repoFromUrl, githubLink)
//  - 표시는 "참고용"이다. 안전을 보장하지 않는다.

/** 출처 등급: 위로 갈수록 확인된 정도가 높다 */
export type Tier = 'official' | 'anthropic' | 'partner' | 'added' | 'listed' | 'github'

/** GitHub 검색 결과에서 주의해야 할 신호 */
export type Flag = 'stale' | 'fresh' | 'noLicense' | 'fork' | 'ratio'

// 제어 문자, 줄바꿈, 글자 방향을 뒤집는 문자(Trojan Source), 보이지 않는 글자를 공백으로 바꾼다
const INVISIBLE =
  /[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁤⁦-⁩﻿᠎]/g

/** 화면에 찍을 글자를 안전하게 정리하고 길이를 줄인다 */
export const clean = (s: unknown, max = 200): string => {
  const t = String(s ?? '')
    .replace(INVISIBLE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}

/** 플러그인·마켓플레이스 이름: 명령에 그대로 써도 안전한 글자만. 아니면 빈 문자열 */
export const safeName = (n: unknown): string => {
  const s = typeof n === 'string' ? n : ''
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(s) ? s : ''
}

/** owner/repo: GitHub이 허용하는 글자만, 맨 앞이 '-'면 명령 옵션으로 읽힐 수 있어 거절. 아니면 빈 문자열 */
export const safeRepo = (r: unknown): string => {
  const s = (typeof r === 'string' ? r : '').replace(/\.git$/i, '')
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,38}\/[A-Za-z0-9_.][A-Za-z0-9._-]{0,99}$/.test(s) && !s.includes('..') ? s : ''
}

/** 주소에서 owner/repo만 뽑는다. https://github.com/ 로 시작해야 하고, 그 밖의 호스트·주소 꼴은 모두 거절 */
export const repoFromUrl = (u: unknown): string => {
  const m = String(u ?? '').match(/^https:\/\/github\.com\/([^/?#\s]+)\/([^/?#\s]+?)(?:\.git)?(?:[/?#].*)?$/i)
  return m ? safeRepo(`${m[1]}/${m[2]}`) : ''
}

/** 검증된 owner/repo로 직접 만든 GitHub 주소. 검증 실패면 빈 문자열 */
export const githubLink = (repo: string): string => {
  const r = safeRepo(repo)
  return r ? `https://github.com/${r}` : ''
}

export const ownerOf = (repo: string): string => safeRepo(repo).split('/')[0] ?? ''

/** 디렉터리의 검토 기록에서 등급을 정한다 */
export const tierFromReview = (state: unknown, by: unknown): Tier => {
  if (state !== 'done') return 'listed'
  if (by === 'anthropic') return 'anthropic'
  if (by === 'partner') return 'partner'
  return 'listed' // 누가 검토했는지 모르면 높게 치지 않는다
}

/** 정렬에 쓰는 순위 (클수록 확인된 정도가 높다) */
export const tierRank = (t: Tier): number =>
  ({ official: 5, anthropic: 5, partner: 4, added: 3, listed: 2, github: 1 })[t]

/** 관련도 점수에 더하는 가산점. 관련 없는 것이 관련 높은 것을 밀어내지 않을 만큼만 */
export const tierBonus = (t: Tier): number =>
  ({ official: 3, anthropic: 3, partner: 2, added: 1, listed: 0, github: 0 })[t]

/** 디렉터리가 검토했거나 공식 마켓플레이스에 든 출처 (별이 적어도 별 기준으로 거르지 않는다) */
export const isVerifiedTier = (t: string): boolean => t === 'official' || t === 'anthropic' || t === 'partner'

/** 순위를 매기고 합치는 데 쓰는 추천 한 건의 값 */
export type Reco = {
  id: string
  name: string
  summary: string
  repo: string
  owner: string
  tier: string
  flags: string[]
  installed: boolean
  stars?: number
  forks?: number
  pushed?: string
  lic?: string
  cmd: string
  source: 'dir' | 'github'
  /** 검색어와 얼마나 맞는지 (이름에 든 단어 3점, 설명에 든 단어 1점) */
  rel: number
}

/** 추천 1·2위 후보가 되려면 이 점수 이상이어야 한다: 이름·저장소 주제·설명 앞부분 중 어딘가에 검색어가 있어야 한다 */
export const MIN_REL = 2

/**
 * 검색어와 얼마나 맞는지:
 *  - 3점: 이름이나 저장소가 스스로 붙인 주제(topics)에 검색어가 있다 (만든 사람이 그 일을 한다고 밝힌 것)
 *  - 2점: 설명 앞부분(100자)에 있다
 *  - 1점: 설명 뒤쪽에서만 언급된다 (곁다리일 때가 많다)
 *  - 0점: 없다
 * 예: "PDF"를 입력 파일 형식 중 하나로만 언급하는 코드 분석 도구가, 별이 많다는 이유로 PDF 도구 1위가 되지 않게 한다.
 */
export const relevance = (name: string, description: string, terms: string[], topics: string[] = []): number => {
  const n = name.toLowerCase()
  const d = description.toLowerCase()
  const tp = topics.map(t => t.toLowerCase())
  const ts = terms.map(t => t.toLowerCase()).filter(Boolean)
  if (ts.some(t => n.includes(t) || tp.some(x => x.includes(t)))) return 3
  if (ts.some(t => d.slice(0, 100).includes(t))) return 2
  if (ts.some(t => d.includes(t))) return 1
  return 0
}

/** 별이 있는데 기준(minStars)보다 적고, 검토된 출처도 아니라서 믿을 근거가 부족한 것 */
export const isLowStars = (r: { tier: string; stars?: number }, minStars: number): boolean =>
  !isVerifiedTier(r.tier) && r.stars !== undefined && r.stars < minStars

/**
 * 디렉터리 결과와 GitHub 결과를 저장소(owner/repo)별로 한 건으로 합친다.
 * 이름·설명·명령은 디렉터리 쪽을, 별·갈라 쓴 수·갱신일·라이선스 같은 실측값은 GitHub 쪽을 따르고, 출처 등급은 더 높은 쪽을 따른다.
 */
export const mergeRecos = (local: Reco[], github: Reco[]): Reco[] => {
  const out = new Map<string, Reco>()
  const key = (r: Reco) => (r.repo ? r.repo.toLowerCase() : `id:${r.id}`)
  for (const r of local) out.set(key(r), { ...r })
  for (const g of github) {
    const k = key(g)
    const d = out.get(k)
    if (!d) {
      out.set(k, { ...g })
      continue
    }
    out.set(k, {
      ...d,
      stars: g.stars ?? d.stars,
      forks: g.forks ?? d.forks,
      pushed: g.pushed || d.pushed,
      lic: g.lic || d.lic,
      flags: g.flags.length > 0 ? g.flags : d.flags,
      tier: tierRank(g.tier as Tier) > tierRank(d.tier as Tier) ? g.tier : d.tier,
      installed: d.installed || g.installed,
      cmd: d.cmd || g.cmd,
      rel: Math.max(d.rel, g.rel),
    })
  }
  return [...out.values()]
}

/**
 * 별이 가장 많은 순으로 정하고, 위에서 topN개를 "추천"으로 뽑는다.
 *  - 별을 아는 것이 먼저, 별이 같으면 출처가 확인된 것, 그다음 검색어와 더 맞는 것
 *  - 추천 후보는 (검토된 출처이거나 별이 minStars 이상) 이면서 검색어와 충분히 맞는 것(rel ≥ MIN_REL)만.
 *    이름·주제로 밝힌 것(rel 3)이 설명 앞부분 언급(rel 2)보다 먼저다. 나머지는 아래로 내려간다
 *  - 별을 하나도 모르면(아직 확인 전) 추천을 뽑지 않고 출처·관련도 순으로만 둔다
 */
export const rankRecos = <T extends Reco>(
  items: T[],
  minStars: number,
  topN = 2,
): { top: T[]; rest: T[]; starsKnown: boolean } => {
  const starsKnown = items.some(i => i.stars !== undefined)
  const sorted = [...items].sort((a, b) => {
    const ka = a.stars !== undefined, kb = b.stars !== undefined
    if (ka !== kb) return ka ? -1 : 1
    if (ka && kb && a.stars !== b.stars) return (b.stars ?? 0) - (a.stars ?? 0)
    return tierRank(b.tier as Tier) - tierRank(a.tier as Tier) || b.rel - a.rel
  })
  if (!starsKnown) return { top: [], rest: sorted, starsKnown }
  const eligible = (i: T) => isVerifiedTier(i.tier) || (i.stars !== undefined && i.stars >= minStars)
  // 이름·주제로 그 일을 한다고 밝힌 것(3점)을 먼저, 모자라면 설명 앞부분에 언급한 것(2점)으로 채운다. 각각 별이 많은 순.
  const strong = sorted.filter(i => eligible(i) && i.rel >= 3)
  const weak = sorted.filter(i => eligible(i) && i.rel >= MIN_REL && i.rel < 3)
  const top = [...strong, ...weak].slice(0, topN)
  const picked = new Set(top)
  return { top, rest: sorted.filter(i => !picked.has(i)), starsKnown }
}

const DAY = 24 * 60 * 60 * 1000

/** GitHub 검색 결과 한 건에서 주의 신호를 뽑는다. 호출 없이 응답에 든 값만 쓴다 */
export const githubFlags = (
  g: {
    pushed_at?: string
    created_at?: string
    license?: { spdx_id?: string | null } | null
    fork?: boolean
    stargazers_count?: number
    forks_count?: number
  },
  now: number = Date.now(),
): Flag[] => {
  const out: Flag[] = []
  const pushed = Date.parse(g.pushed_at ?? '')
  const created = Date.parse(g.created_at ?? '')
  if (Number.isFinite(pushed) && now - pushed > 365 * DAY) out.push('stale')
  if (Number.isFinite(created) && now - created < 30 * DAY) out.push('fresh')
  const spdx = g.license?.spdx_id
  if (!g.license || !spdx || spdx === 'NOASSERTION') out.push('noLicense')
  if (g.fork === true) out.push('fork')
  const stars = g.stargazers_count ?? 0
  const forks = g.forks_count ?? 0
  // 별은 많은데 갈라 쓴 사람이 거의 없으면 별 수를 믿기 어렵다 (건강한 프로젝트는 보통 10~30배 안쪽)
  if (stars >= 500 && stars / Math.max(forks, 1) > 60) out.push('ratio')
  return out
}
