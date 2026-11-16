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
