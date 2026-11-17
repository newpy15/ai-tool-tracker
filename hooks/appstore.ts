// Claude 앱이 자기 저장소(rpm)에 설치해 둔 플러그인을 읽어 오기 위한 순수 함수 모음. Claude Code 없이 시험할 수 있다 (test/appstore.test.mjs).
// 앱 저장소의 이름·설명·주소도 "남이 쓴 글"로 다룬다: 화면에 찍기 전에 정리하고, 주소는 github.com 의 owner만 뽑는다.
//
// 다른 파일에서 값을 불러오지 않는다. 아래 정리 규칙은 trust.ts와 같으며 시험이 같은지 확인한다.

export type AppRef = { id: string; displayName: string; marketplace: string; owner: string }
export type AppSkill = { name: string; summary: string }
export type AppPlugin = AppRef & { version: string; summary: string; skills: AppSkill[]; hasMcp: boolean }

export const MAX_APP_PLUGINS = 60

// trust.ts의 clean과 같은 규칙: 제어 문자, 줄바꿈, 글자 방향을 뒤집는 문자, 보이지 않는 글자를 공백으로
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁤⁦-⁩﻿᠎]/g
export const cleanText = (s: unknown, max = 200): string => {
  const t = String(s ?? '').replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}

/** 폴더 이름으로 써도 안전한 한 토막 (경로를 거슬러 올라가는 글자 금지) */
export const safeSegment = (n: unknown): string => {
  const s = typeof n === 'string' ? n : ''
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(s) && !s.includes('..') ? s : ''
}

/** 앱이 정한 플러그인 id (plugin_ 뒤에 글자·숫자) */
export const safePluginId = (n: unknown): string => {
  const s = typeof n === 'string' ? n : ''
  return /^plugin_[A-Za-z0-9]{1,40}$/.test(s) ? s : ''
}

/** https://github.com/<owner>/<repo> 주소에서 owner만 뽑는다. 그 밖의 주소는 빈 문자열 */
export const ownerFromUrl = (u: unknown): string => {
  const m = String(u ?? '').match(/^https:\/\/github\.com\/([^/?#\s]+)\/([^/?#\s]+?)(?:\.git)?(?:[/?#].*)?$/i)
  if (!m) return ''
  const owner = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(m[1]) ? m[1] : ''
  const repo = /^[A-Za-z0-9_.][A-Za-z0-9._-]{0,99}$/.test(m[2]) && !m[2].includes('..') ? m[2] : ''
  return owner && repo ? owner : ''
}

/** manifest.json (글 또는 이미 읽은 값)에서 플러그인 목록을 안전하게 뽑는다 */
export const parseManifest = (raw: unknown): AppRef[] => {
  let d: any = raw
  if (typeof raw === 'string') {
    try {
      d = JSON.parse(raw)
    } catch {
      return []
    }
  }
  const out: AppRef[] = []
  const seen = new Set<string>()
  for (const p of Array.isArray(d?.plugins) ? d.plugins : []) {
    const id = safePluginId(p?.id)
    const displayName = cleanText(p?.displayName ?? p?.name, 60)
    if (!id || !displayName || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      displayName,
      marketplace: cleanText(p?.marketplaceName, 40),
      owner: ownerFromUrl(p?.upstreamRepoUrl),
    })
    if (out.length >= MAX_APP_PLUGINS) break
  }
  return out
}

/** 설명의 첫 문장만, 한 줄로 */
export const firstSentence = (desc: unknown, max = 80): string => {
  const flat = cleanText(desc, 600)
  const first = flat.split(/(?<=[.。!?])\s/)[0] ?? flat
  return first.length > max ? first.slice(0, max) + '…' : first
}

/** .claude-plugin/plugin.json 글에서 버전과 설명을 안전하게 뽑는다 */
export const parsePluginJson = (text: unknown): { version: string; summary: string } => {
  try {
    const d = JSON.parse(String(text ?? ''))
    return { version: cleanText(d?.version, 20), summary: firstSentence(d?.description) }
  } catch {
    return { version: '', summary: '' }
  }
}

/** 목록·설명·스킬을 합쳐 화면에 쓸 플러그인 한 건을 만든다 (스킬 이름과 설명도 정리한다) */
export const buildAppPlugin = (ref: AppRef, pluginJson: unknown, skills: { name: unknown; summary: unknown }[], hasMcp: boolean): AppPlugin => {
  const pj = parsePluginJson(pluginJson)
  return {
    ...ref,
    version: pj.version,
    summary: pj.summary,
    skills: skills
      .map(s => ({ name: cleanText(s.name, 60), summary: firstSentence(s.summary, 80) }))
      .filter(s => s.name !== '')
      .slice(0, 40),
    hasMcp,
  }
}
