// 플러그인·스킬을 용도별로 묶는 규칙. Claude Code와 무관한 순수 함수라 단독으로 시험할 수 있다 (test/categories.test.mjs).
//
// 분류는 이름과 설명에 든 단어로 정한다. 사전에 없는 것은 '기타'로 둔다. 추측으로 억지로 넣지 않는다.

export type CatKey =
  | 'video' | 'captions' | 'image' | 'planning' | 'web' | 'dev' | 'data' | 'security' | 'files' | 'marketing' | 'other'

/** 화면에 보여주는 순서 */
export const CATEGORY_ORDER: CatKey[] = [
  'video', 'captions', 'image', 'planning', 'web', 'dev', 'data', 'security', 'files', 'marketing', 'other',
]

// 짧은 영어(4글자 이하)는 단어 경계로 찾고, 나머지는 포함 여부로 찾는다 (예: 'code'가 'barcode'에 걸리지 않게)
export const CATEGORY_KEYWORDS: Record<Exclude<CatKey, 'other'>, string[]> = {
  video: ['video', 'remotion', 'hyperframes', 'animation', 'motion graphics', 'film', 'render', 'ffmpeg', 'footage', 'movie', '영상', '동영상', '비디오', '애니메이션'],
  captions: ['caption', 'subtitle', 'transcri', 'whisper', 'tts', 'voice', 'speech', 'audio', 'music', 'dubbing', '자막', '음성', '받아쓰기', '목소리', '음악'],
  image: ['image', 'illustration', 'logo', 'photo', 'picture', 'design', 'figma', 'canvas', 'mockup', 'icon', 'ui', 'ux', '이미지', '일러스트', '로고', '사진', '디자인', '피그마'],
  planning: ['planning', 'roadmap', 'specification', 'prd', 'strategy', 'brainstorm', 'outline', 'proposal', 'document', 'docs', 'notion', 'presentation', 'slides', 'pptx', 'docx', 'pdf', 'spreadsheet', 'xlsx', 'memo', '기획', '계획', '문서', '발표', '슬라이드', '회의', '메모'],
  web: ['website', 'browser', 'frontend', 'landing page', 'html', 'css', 'chrome', 'puppeteer', 'playwright', 'web app', '웹사이트', '홈페이지', '브라우저'],
  dev: ['code', 'coding', 'git', 'github', 'repository', 'pull request', 'test', 'debug', 'deploy', 'deployment', 'api', 'sdk', 'cli', 'compiler', 'kernel', 'inference', 'framework', 'devops', 'developer', '개발', '배포', '코드', '테스트'],
  data: ['database', 'sql', 'postgres', 'mysql', 'analytics', 'chart', 'dashboard', 'dataset', 'bigquery', 'warehouse', 'etl', '데이터', '차트', '대시보드'],
  security: ['security', 'vulnerability', 'vulnerabilities', 'cve', 'malware', 'secret', 'sast', 'exploit', 'threat', 'compliance', '보안', '취약점'],
  files: ['storage', 'cloud storage', 'drive', 'file sharing', 'content management', 'folder', 'upload', 'box', '파일', '클라우드', '저장소'],
  marketing: ['marketing', 'seo', 'social media', 'youtube', 'instagram', 'campaign', 'newsletter', '마케팅', '광고', '유튜브', '인스타'],
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const hit = (text: string, kw: string): boolean =>
  /^[a-z0-9 ]+$/.test(kw) && kw.length <= 4 ? new RegExp(`(^|[^a-z0-9])${esc(kw)}([^a-z0-9]|$)`).test(text) : text.includes(kw)

export type Classifiable = {
  name: string
  description: string
  skills: { name: string; description: string }[]
  /** 에이전트 이름(설명은 없어도 된다) */
  agents?: { name: string; description?: string }[]
}

// 이름과 플러그인 자신의 설명은 크게, 안에 든 스킬·에이전트에서 나온 점수는 한 분류가 독차지하지 못하게 상한을 둔다
const W = { name: 6, desc: 3, skillName: 1, skillDesc: 1, agentName: 3, agentDesc: 1 }
const CAP = 3 // 스킬 이름·스킬 설명·에이전트 이름·에이전트 설명 각각에서 한 분류가 받을 수 있는 단어 수의 상한

/** 이름·플러그인 설명·스킬·에이전트에 든 단어로 점수를 매겨 가장 높은 용도를 고른다. 점수가 3점 미만이면 '기타' */
export const categorize = (x: Classifiable): CatKey => {
  const name = x.name.toLowerCase()
  const desc = x.description.toLowerCase()
  const skillNames = x.skills.map(s => s.name.toLowerCase()).join(' ')
  const skillDescs = x.skills.map(s => s.description.toLowerCase()).join(' ')
  const agentNames = (x.agents ?? []).map(a => a.name.toLowerCase()).join(' ')
  const agentDescs = (x.agents ?? []).map(a => (a.description ?? '').toLowerCase()).join(' ')
  let best: CatKey = 'other'
  let bestScore = 2 // 3점 이상이어야 분류한다
  for (const key of CATEGORY_ORDER) {
    if (key === 'other') continue
    let nameHits = 0, descHits = 0, sName = 0, sDesc = 0, aName = 0, aDesc = 0
    for (const kw of CATEGORY_KEYWORDS[key]) {
      if (hit(name, kw)) nameHits++
      if (hit(desc, kw)) descHits++
      if (hit(skillNames, kw)) sName++
      if (hit(skillDescs, kw)) sDesc++
      if (hit(agentNames, kw)) aName++
      if (hit(agentDescs, kw)) aDesc++
    }
    const score =
      nameHits * W.name + descHits * W.desc +
      Math.min(sName, CAP) * W.skillName + Math.min(sDesc, CAP) * W.skillDesc +
      Math.min(aName, CAP) * W.agentName + Math.min(aDesc, CAP) * W.agentDesc
    if (score > bestScore) {
      best = key
      bestScore = score
    }
  }
  return best
}
