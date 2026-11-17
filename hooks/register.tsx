import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { RecoGroup, RecoItem, RecoState, Use } from '../types'
import {
  clean, githubFlags, githubLink, isLowStars, mergeRecos, ownerOf, rankRecos, relevance, repoFromUrl, safeName,
  safeRepo, tierBonus, tierFromReview, tierRank,
} from './trust'
import type { Tier } from './trust'
import { categorize, CATEGORY_ORDER } from './categories'
import type { CatKey } from './categories'
import {
  addUsage, AGENT_CATS, buildSpec, MAX_SPAWNS_PER_PROMPT, nextGuard, catOfType, cfgOf, cycle, DEFAULT_SETTINGS, fmtTokens, isOver, MODEL_PRESETS,
  modelLabel, changeModel, fit, limitsOf, parseModel, parseSettings, parseTokens, parseTurns, PLUGIN_ID, tokensOf,
} from './agents'
import type { AgentSettings, AgentUse } from './agents'
import { attribute, bar, levelColor, levelOf, overGuard, pct, pickWindow, shouldWarn, untilReset } from './usage'
import type { Level } from './usage'
import { DAY_OPTIONS, DEFAULT_DAYS, emptyHistory, merge, parseHistory, record, unusedList } from './history'
import type { History } from './history'
import {
  addCustom, cleanLabel, deleteCustom, enabledNames, isEmptyPlan, MAX_CUSTOM, migrateMine, newId, parseCustom, parseMine,
  planByCats, planByNames, PRESETS, renameCustom, replaceMembers, toggleMember,
} from './presets'
import type { Custom, Plan, PlanItem } from './presets'

const PANE = 'ai-tools'

const uses = atom({ plugin: 'ai-tool-tracker', key: 'uses' } as const, [], {
  shape: 'uses-1',
})
const moves = atom({ plugin: 'ai-tool-tracker', key: 'moves' } as const, {}, {
  shape: 'moves-1',
})
// 지금 보고 있는 탭: tools | log | env
const tabState = atom({ plugin: 'ai-tool-tracker', key: 'tab' } as const, 'tools', {
  shape: 'tab-1',
})
// 도구 탭 안에서 보고 있는 구역: plugins | skills
const subState = atom({ plugin: 'ai-tool-tracker', key: 'sub' } as const, 'plugins', {
  shape: 'sub-1',
})
// 추천 탭에 보여줄 결과 (프롬프트 원문은 저장하지 않는다: 주제와 검색어만)
const EMPTY_RECO: RecoState = { groups: [], at: 0 }
const recoState = atom({ plugin: 'ai-tool-tracker', key: 'reco' } as const, EMPTY_RECO, {
  shape: 'reco-4', // 항목의 모양(관련도·갈라 쓴 수)과 묶음의 모양(별 확인 상태)을 바꿨으므로 태그도 올린다: 이전 버전이 저장한 값을 버리게 한다
})
// 용도별 하위 에이전트 설정(저장소에도 따로 보관)과 이 세션에서 쓴 양
const agentCfgState = atom({ plugin: 'ai-tool-tracker', key: 'agents' } as const, DEFAULT_SETTINGS, {
  shape: 'agents-1',
})
const agentUseState = atom({ plugin: 'ai-tool-tracker', key: 'agentUse' } as const, {} as AgentUse, {
  shape: 'agentuse-1',
})
// 펼쳐진 항목 이름 -> true
const open = atom({ plugin: 'ai-tool-tracker', key: 'open' } as const, {}, {
  shape: 'open-1',
})

// ---------------------------------------------------------------------------
// 1) 보기 좋은 이름이 필요한 도구만 직접 적은 덮어쓰기 목록 (없어도 동작함)
// ---------------------------------------------------------------------------
type Entry = { key: string; label: string; role: string; match: RegExp }
const CATALOG: Entry[] = [
  { key: 'remotion', label: 'Remotion', role: '코드로 동영상 제작·렌더링', match: /remotion/i },
  { key: 'hyperframes', label: 'HyperFrames', role: 'HTML로 영상·모션 그래픽 제작', match: /hyperframes|reverse-any-video|slideshow|style-sampling/i },
  { key: 'figma', label: 'Figma', role: 'UI 디자인·와이어프레임·디자인→코드', match: /figma/i },
  { key: 'notion', label: 'Notion', role: '문서·DB·일정 정리와 저장', match: /notion/i },
  { key: 'artifact', label: 'Artifact', role: '공유 가능한 웹페이지·대시보드 발행', match: /^Artifact|artifact-/i },
  { key: 'chrome', label: 'Chrome 브라우저', role: '실제 크롬에서 웹 탐색·입력·확인', match: /claude-in-chrome|chrome-browser/i },
  { key: 'browser', label: '내장 브라우저', role: 'localhost 미리보기·화면 검증', match: /Claude_Browser|built-in-browser/i },
  { key: 'terminal', label: '터미널', role: '명령 실행·서버 구동', match: /^mcp__terminal|^Bash$|^PowerShell$/ },
  { key: 'agent', label: '서브에이전트', role: '조사·분석 등 별도 작업 위임', match: /^Agent$/ },
  { key: 'ccd', label: '데스크톱 기본 도구', role: 'Claude 데스크톱 앱 자체 기능 (작업 목록, 화면 보기, 세션 관리 등)', match: /^mcp__ccd_/ },
  { key: 'files', label: '파일 편집', role: '코드·문서 파일 작성/수정', match: /^(Write|Edit|NotebookEdit)$/ },
  { key: 'research', label: '웹 조사', role: '웹 검색·페이지 읽기', match: /^(WebSearch|WebFetch)$/ },
]

// ---------------------------------------------------------------------------
// 2) 이 PC에 설치된 스킬·플러그인을 읽어서 만드는 색인
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 언어: 설치 때 고른 language 옵션. ko/en 은 직접 적은 문구를 쓰고,
// 설명 문구는 언어가 다르면 모델로 한 번 번역해 저장해 둔다.
// ---------------------------------------------------------------------------
let lang = 'ko'
let minStars = 10 // 이보다 별이 적고 검토되지 않은 것은 추천하지 않는다 (환경 탭에서 바꿀 수 있다)
// 번역 저장소: 언어마다 따로 둔다. (하나를 같이 쓰면 언어를 바꾸는 사이 다른 언어 결과가 섞인다)
const tmaps: Record<string, Record<string, string>> = {}
const loadedLangs = new Set<string>()

// 번역문이 정말 그 언어의 글자로 되어 있는지 가볍게 확인한다 (섞인 번역을 걸러내는 마지막 방어선)
const HANGUL = /[가-힣]/
const KANA = /[぀-ヿ]/
const HAN = /[一-鿿]/
const looksLike = (l: string, text: string): boolean => {
  if (l === 'ko') return HANGUL.test(text)
  if (l === 'ja') return (KANA.test(text) || HAN.test(text)) && !HANGUL.test(text)
  if (l === 'zh') return HAN.test(text) && !KANA.test(text) && !HANGUL.test(text)
  return !HANGUL.test(text) && !KANA.test(text) && !HAN.test(text) // en/es/fr/de
}

const LANG_NAME: Record<string, string> = {
  ko: 'Korean', en: 'English', ja: 'Japanese', zh: 'Simplified Chinese',
  es: 'Spanish', fr: 'French', de: 'German',
}
const LANG_LABEL: Record<string, string> = {
  ko: '한국어', en: 'English', ja: '日本語', zh: '中文', es: 'Español', fr: 'Français', de: 'Deutsch',
}
// 한국어로 고정돼 있던 도구 이름표의 영어판 (다른 언어는 이것을 번역한다)
const LABEL_EN: Record<string, string> = {
  terminal: 'Terminal',
  agent: 'Subagents',
  files: 'File edits',
  research: 'Web research',
  chrome: 'Chrome browser',
  browser: 'Built-in browser',
  ccd: 'Desktop built-ins',
}
const ROLE_EN: Record<string, string> = {
  ccd: 'Claude desktop app built-in features (task list, panes, sessions)',
  remotion: 'Make and render videos with code',
  hyperframes: 'Make videos and motion graphics from HTML',
  figma: 'UI design, wireframes, design-to-code',
  notion: 'Organize and store docs, databases and schedules',
  artifact: 'Publish shareable web pages and dashboards',
  chrome: 'Browse, type and check pages in your real Chrome',
  browser: 'Preview localhost and verify what is on screen',
  terminal: 'Run commands and start servers',
  agent: 'Hand research or analysis to a separate agent',
  files: 'Write and edit code and document files',
  research: 'Web search and reading pages',
}
const UI = {
  ko: {
    used: '사용한 도구와 주 종목',
    none: '아직 기록 없음. 작업을 시작하면 자동으로 쌓입니다.',
    timeline: '타임라인',
    noInst: '설치된 스킬·플러그인을 찾지 못했습니다.',
    skills: (n: number) => ` (스킬 ${n}개)`,
    noDesc: '설명 없음',
    unknown: '설명 없음 (설치 목록에서 못 찾은 도구)',
    ext: '외부 도구 (수동 기록)',
    plugin: '플러그인',
    skill: '스킬',
    opened: (n: number) => `AI 도구 현황 패널을 열었습니다. (설치된 항목 ${n}개 읽음)`,
    on: '켜짐',
    off: '꺼짐',
    subPlugins: (n: number) => `플러그인 (${n})`,
    subSkills: (n: number) => `스킬 (${n})`,
    noneHere: '이 구역에는 항목이 없습니다.',
    mcpGeneric: '연결된 MCP 서버의 도구 (설치 목록에 설명 없음)',
    secPlugins: (n: number) => `플러그인 ${n}개 · 켜기/끄기`,
    hintPlugins: '켜져 있는 동안 훅·MCP 서버는 계속 동작합니다. 스킬은 부를 때만 적용됩니다.',
    secSkills: (n: number) => `스킬 ${n}개 · 명령어로 호출`,
    hintSkills: '/이름 으로 부르면 적용됩니다. 부르지 않으면 동작하지 않습니다. (설명만 항상 올라가 있음)',
    turnOn: '켜기',
    turnOff: '끄기',
    agentTag: '에이전트',
    noParts: '스킬·에이전트·MCP 서버 없음',
    nowOn: '켰습니다. 다음에 Claude Code를 시작할 때부터 적용됩니다.',
    nowOff: '껐습니다. 다음에 Claude Code를 시작할 때부터 적용됩니다. (설명이 모델에 올라가지 않아 토큰도 줄어듭니다)',
    cacheTitle: (n: number) => `옛 캐시 ${n}개`,
    cacheNone: '지울 옛 캐시가 없습니다.',
    cacheBtn: '옛 캐시 지우기',
    cacheAsk: (n: number) =>
      `폴더 ${n}개를 삭제합니다. 현재 설치된 버전과 사용 중 표시가 있는 것은 건드리지 않습니다. 되돌릴 수 없습니다.`,
    cacheDone: (n: number) => `${n}개를 지웠습니다.`,
    cacheOk: '확인',
    cacheSkipped: (n: number) => `사용 중 표시가 있어 건너뛴 것 ${n}개`,
    updateGlobal: '전체 설치본 갱신',
    tabTools: '도구',
    tabLog: (n: number) => (n > 0 ? `실시간 로그 (${n})` : '실시간 로그'),
    tabEnv: '환경',
    showMore: (n: number) => `▾ ${n}개 더 보기`,
    showLess: '▴ 목록 줄이기',
    env: '감지한 환경',
    envRoot: '기준 폴더',
    envCount: (p: number, s: number, m: number) => `읽은 항목: 플러그인 ${p}개 · 스킬 ${s}개 · MCP ${m}개`,
    cliOk: '사용 가능',
    cliNo: '없음 (전체 설치·마켓플레이스 등록에는 이 명령이 필요합니다)',
    envNone: '설정 폴더에서 아무것도 읽지 못했습니다. CLAUDE_CONFIG_DIR 또는 사용자 폴더 위치를 확인하세요.',
    unreadHead: '읽지 못한 항목',
    langLabel: '언어',
    scopeAll: '전체',
    scopeFolder: (p: string) => `폴더 ${p}`,
    folderOnly: '특정 폴더에서만 쓰는 도구',
    noFolder: (n: number) => `폴더 전용 도구가 없습니다. (검사한 프로젝트 ${n}개)`,
    alreadyGlobal: '이미 전체에 있음 (옮길 필요 없음)',
    toGlobal: '전체로 옮기기',
    askCopy: '전체(모든 폴더)에서 쓰도록 복사할까요? 원본은 그대로 둡니다.',
    yes: '예',
    cancel: '취소',
    copied: '전체에 복사했습니다. 원본은 그대로 남아 있습니다.',
    removeOrig: '원본 삭제',
    askRemove: '원본을 삭제할까요? 되돌릴 수 없습니다.',
    removed: '옮기기를 마쳤습니다. (원본 삭제됨)',
    manualOff: '이 폴더의 설정에서 직접 꺼 주세요.',
    modLabel: '모드(이 세션 전용)',
    askMod: '전체 설치용 폴더(~/.claude/local-mods)에 복사해 모든 프로젝트에서 쓰도록 설치할까요? 이후 원본을 고쳐도 자동 반영되지 않습니다.',
    modKeep: '세션 폴더의 원본은 지우지 않았습니다. 다음 세션부터 전체 설치본이 쓰입니다.',
    allOn: '전체 켜기',
    allOff: '전체 끄기',
    groupOn: '이 묶음 켜기',
    groupOff: '이 묶음 끄기',
    bulkAskOn: (n: number) => `플러그인 ${n}개를 켭니다. 다음에 Claude Code를 시작할 때부터 적용됩니다. 계속할까요?`,
    bulkAskOff: (n: number) =>
      `플러그인 ${n}개를 끕니다. 다음에 Claude Code를 시작할 때부터 적용되고, 켜기로 되돌릴 수 있습니다. 이 플러그인(ai-tool-tracker)은 끄지 않습니다. 계속할까요?`,
    bulkRun: (i: number, n: number) => `처리 중… ${i}/${n}`,
    bulkDone: (n: number) => `${n}개를 바꿨습니다. 다음에 Claude Code를 시작할 때부터 적용됩니다.`,
    catg_video: '영상',
    catg_captions: '자막·음성',
    catg_image: '이미지·디자인',
    catg_planning: '기획·문서',
    catg_web: '웹·브라우저',
    catg_dev: '개발·배포',
    catg_data: '데이터·DB',
    catg_security: '보안',
    catg_files: '파일·클라우드',
    catg_marketing: '마케팅·SNS',
    catg_other: '기타',
    recoPick: (n: number) => `추천 ${n}위`,
    recoTop: (n: number) => `추천 · 별이 가장 많은 ${n}개`,
    recoRestShow: (n: number) => `나머지 ${n}개 보기`,
    recoRestHide: '나머지 숨기기',
    recoNoTop: (m: number) => `별 ${m}개 이상인 후보가 없어 추천할 수 없습니다. 아래 후보는 별이 적습니다.`,
    recoStarsUnknown: '별 개수를 아직 확인하지 않았습니다. 별이 가장 많은 것을 추천하려면 아래 버튼으로 확인하세요.',
    recoStarsBtn: '별 개수 확인',
    recoStarsChecking: '별 개수를 확인하는 중…',
    fewStars: (n: number, m: number) =>
      `별 ${n}개 — 기준(${m}개)보다 적어, 아직 아는 사람이 거의 없습니다. 믿을 근거가 부족합니다.`,
    starsUnknown: '별: 확인 전',
    minStarsLabel: '추천에 필요한 최소 별 개수',
    minStarsHint: '검토되지 않은 저장소는 별이 이 개수보다 적으면 추천하지 않습니다. 0이면 거르지 않습니다.',
    agTitle: '분업 (용도별 하위 에이전트)',
    agHint: '켜면 영상·개발 같은 묶음마다 전용 하위 에이전트가 생기고, 그 일은 정해 둔 모델과 토큰 한도 안에서 맡습니다. 에이전트 목록이 매 턴 조금 늘어나므로 기본은 꺼져 있습니다. 바꾸면 다음 턴부터 적용됩니다. 값은 입력칸에 쓰고 Enter를 누르세요.',
    guardDeny: (label: string, p: number, g: number) =>
      `${label} 사용량이 ${p}%라서(보호 기준 ${g}%) 새 하위 에이전트를 시작하지 않았습니다. 초기화된 뒤에 다시 시도하거나, 환경 탭에서 보호 기준을 올릴 수 있습니다.`,
    spawnCap: (n: number) => `한 번의 요청에서는 하위 에이전트를 ${n}개까지만 시작합니다. 나머지는 다음 요청에서 하세요.`,
    agGuard: '사용량 보호',
    agGuardOff: '쓰지 않음',
    agGuardHint: '5시간과 주간(7일) 기준을 따로 고릅니다. 그 사용량이 정한 퍼센트 이상이면 새 하위 에이전트를 시작하지 않습니다. 둘 다 끌 수는 없습니다.',
    tabMode: '작업 모드',
    prTitle: '작업 모드',
    prHint: '지금 하려는 일에 맞는 플러그인만 켜고 나머지는 끕니다. 누르면 먼저 무엇이 바뀌는지 보여 주고 확인을 받습니다.',
    prBuiltin: '기본 모드',
    pr_video: '영상 작업',
    pr_docs: '문서·기획 작업',
    pr_web: '웹·개발 작업',
    pr_data: '데이터 작업',
    prMineTitle: '내 프리셋',
    prEmpty: '아직 없습니다. 아래에 이름을 쓰면 지금 켜진 플러그인으로 만들고, 기본 모드의 `내 프리셋으로 복사`로도 만들 수 있습니다.',
    prNewLabel: '새 프리셋 이름:',
    prNewHint: '지금 켜진 플러그인으로 만듭니다 (Enter)',
    prFull: (n: number) => `내 프리셋은 ${n}개까지 만들 수 있습니다. 안 쓰는 것을 지운 뒤 만드세요.`,
    prCount: (n: number) => `${n}개`,
    prSame: '지금 상태와 같음',
    prApply: '적용',
    prEdit: '편집',
    prRename: '이름 바꾸기',
    prDelete: '삭제',
    prCopy: '내 프리셋으로 복사',
    prNameLabel: '이름:',
    prDelAsk: (name: string) => `"${name}" 프리셋을 지울까요? 플러그인 자체는 지워지지 않습니다.`,
    prEditHint: '눌러서 넣고 뺍니다. ✓로 표시된 것이 이 프리셋을 적용할 때 켜 두는 플러그인입니다.',
    prOverwrite: '지금 켜진 것으로 덮어쓰기',
    prEditDone: '완료',
    prNothing: '이미 이 모드와 같은 상태입니다.',
    prAsk: (label: string, on: number, off: number) => `"${label}": ${on}개를 켜고 ${off}개를 끕니다. 진행할까요?`,
    prAskSave: (label: string, on: number, off: number, tok: string) =>
      `"${label}": ${on}개를 켜고 ${off}개를 끕니다 (끄면 상시 약 ${tok} 토큰 절약). 진행할까요?`,
    prRun: (i: number, n: number) => `적용 중… ${i}/${n}`,
    prDone: (n: number) => `${n}개를 바꿨습니다. 다음에 Claude Code를 시작할 때부터 적용됩니다.`,
    prNote: '"기타" 묶음과 이 플러그인 자신은 건드리지 않습니다.',
    unTitle: '안 쓴 플러그인',
    unDays: (n: number) => `${n}일 기준`,
    unLearning: (d: number, n: number) => `사용 기록을 모으는 중입니다(${d}일째). ${n}일이 지나면 안 쓴 플러그인을 알려 드립니다.`,
    unNone: (n: number) => `최근 ${n}일 안에 켜 둔 플러그인을 모두 썼습니다.`,
    unNever: '기록된 사용 없음',
    unAgo: (d: number) => `마지막 사용 ${d}일 전`,
    unOffAll: (n: number) => `안 쓴 ${n}개 모두 끄기`,
    unOffAllSave: (n: number, t: string) => `안 쓴 ${n}개 모두 끄기 (약 ${t} 토큰 절약)`,
    unNote: '플러그인 이름과 마지막 사용 시각, 횟수만 이 PC에 저장합니다. 새로 설치한 것은 아직 안 쓴 것일 수 있고, 도구를 부르지 않고 돕는 플러그인(테마 등)은 안 쓴 것처럼 보일 수 있으니 확인하고 끄세요.',
    tokAlways: (t: string) => `상시 약 ${t} 토큰`,
    tokOffNote: '꺼져 있어 토큰을 쓰지 않음',
    tokTotal: (t: string, n: number) => `켜 둔 플러그인 ${n}개가 대화마다 미리 차지하는 양: 약 ${t} 토큰`,
    tokNote: '"상시"는 쓰지 않아도 매 대화에 올라가는 설명의 어림값입니다. 실제로 쓴 양이 아니며, 끄면 이만큼 줄어듭니다.',
    usTitle: '사용량',
    usFive: '5시간',
    usSeven: '7일',
    usCtx: '대화 길이',
    usCost: '이번 세션',
    usResetH: (h: number, m: number) => `${h}시간 ${m}분 뒤 초기화`,
    usResetM: (m: number) => `${m}분 뒤 초기화`,
    usNone: '아직 사용량 정보가 없습니다. 첫 응답이 끝나면 나옵니다.',
    usNote: 'Claude Code가 알려 주는 퍼센트입니다. 정확한 토큰 수는 공개되지 않습니다.',
    usAdvMid: '절반 넘게 썼습니다. 가벼운 일은 분업에서 Haiku에 맡기면 아낄 수 있습니다.',
    usAdvHigh: '곧 한도입니다. 큰 작업은 초기화 뒤로 미루거나, Haiku와 낮은 토큰 한도로 돌리세요.',
    usAdvFull: '거의 다 썼습니다. 초기화될 때까지 기다리거나 아주 가벼운 일만 하세요.',
    usToast: (p: string) => `5시간 사용량이 ${p}%입니다. 큰 작업 전에 패널의 사용량을 확인하세요.`,
    agRegFail: (label: string) => `${label} 하위 에이전트를 등록하지 못했습니다. 모델 ID가 맞는지 환경 탭에서 확인하세요.`,
    agModel: '모델',
    agModelCustom: '모델 ID 직접 입력:',
    agRange: (min: string, max: string) => `${min} ~ ${max} (예: 150k)`,
    agAdjusted: (min: string, max: string, v: string) => `이 모델에서 허용하는 범위(${min} ~ ${max})를 벗어나 ${v}(으)로 맞췄습니다.`,
    agBad: '알아볼 수 없는 값입니다. 입력한 그대로는 저장하지 않았습니다.',
    agBudget: '토큰 한도',
    agTurns: '최대 턴',
    agNoLimit: '제한 없음',
    agInherit: '지금 모델 그대로',
    agUsed: (runs: number, tokens: string) => `이번 세션 ${runs}회 · ${tokens} 토큰`,
    agOver: (label: string, used: string, budget: string) =>
      `${label} 묶음이 토큰 한도(${budget})에 닿아(${used}) 새 하위 에이전트를 시작하지 않았습니다. 환경 탭에서 한도를 올릴 수 있습니다.`,
    agNone: '분업할 수 있는 묶음이 아직 없습니다. 도구 탭에서 플러그인이 용도별로 묶이면 여기에 나옵니다.',
    agLine: (model: string, budget: string, used: string) => `하위 에이전트: ${model} · 한도 ${budget} · 사용 ${used}`,
    agLimitNote: '한도는 새 하위 에이전트를 시작할 때 확인합니다. 이미 도는 중인 것을 중간에 끊지는 않고, 한 번의 길이는 "최대 턴"으로 막습니다. 하위 에이전트는 시작만 해도 약 6만 토큰이 들어서, 한도는 모델마다 정한 범위(최소 10만) 안에서만 받습니다. 비싼 모델일수록 최대가 낮습니다.',
    tabReco: (n: number) => (n > 0 ? `추천 (${n})` : '추천'),
    recoTitle: '이런 도구는 어때요?',
    recoNone: '아직 추천할 내용이 없습니다. "동영상 만들어줘"처럼 요청하거나 /ai-find 동영상 제작 처럼 검색해 보세요.',
    recoTopic: (c: string, t: string) => `감지한 주제: ${c} · 검색어: ${t}`,
    recoTopicFree: (t: string) => `검색어: ${t}`,
    recoLocalNone: '디렉터리에서 맞는 플러그인을 찾지 못했습니다.',
    recoGithubTitle: 'GitHub 실시간 검색',
    recoGithubBtn: (t: string) => `GitHub에서 더 찾기: ${t}`,
    recoSending: (t: string) =>
      `누르면 검색어 "${t}"와 위 추천 저장소의 이름(owner/repo)이 GitHub로 전송됩니다. 대화 내용은 보내지 않습니다.`,
    recoSearching: 'GitHub에서 찾는 중…',
    recoGhNone: 'GitHub에서 맞는 저장소를 찾지 못했습니다.',
    recoGhErr: (m: string) => `GitHub 검색 실패: ${m}`,
    tier_official: '공식 마켓플레이스',
    tier_anthropic: 'Anthropic 검토',
    tier_partner: '파트너 검토',
    tier_added: '내가 추가한 마켓플레이스',
    tier_listed: '디렉터리 등록 · 검토 전',
    tier_github: '출처 미확인 (GitHub 검색)',
    flag_stale: '1년 넘게 갱신되지 않았습니다',
    flag_fresh: '만든 지 30일이 안 된 저장소입니다',
    flag_noLicense: '라이선스가 없습니다',
    flag_fork: '다른 저장소를 복제해 만든 것입니다',
    flag_ratio: '별 수에 비해 복제한 사람이 매우 적습니다. 별 수를 믿지 마세요',
    ownerLabel: '소유자',
    noCmd: '이름에 특수문자가 있어 설치 명령을 만들지 않았습니다. 저장소 설명을 따라 설치하세요.',
    trustNote: '표시는 참고용이며 안전을 보장하지 않습니다. 설치 전에 소유자가 맞는지, 저장소의 코드와 요구하는 권한을 직접 확인하세요.',
    recoInstalled: '설치됨',
    recoWarn: '검토되지 않은 저장소입니다. 설치 전에 코드와 권한을 직접 확인하세요.',
    recoCopy: '설치 명령 복사',
    recoCopied: '명령을 복사했습니다.',
    recoOpen: '링크 열기',
    recoToast: (n: number, c: string) => `'${c}' 관련 추천 도구 ${n}개 — 추천 탭에서 확인하세요`,
    findUsage: '사용법: /ai-find <찾고 싶은 기능>   예) /ai-find 동영상 제작',
    findStarted: (t: string) => `검색어 "${t}"로 찾는 중입니다. 추천 탭을 확인하세요. (GitHub에도 이 검색어를 보냈습니다)`,
    cat_video: '동영상',
    cat_image: '이미지',
    cat_slides: '발표 자료',
    cat_website: '웹사이트',
    cat_design: '디자인',
    cat_docs: '문서',
    cat_audio: '음악·음성',
    cat_data: '차트·데이터',
    cat_testing: '테스트',
    cat_git: '깃·GitHub',
    cat_db: '데이터베이스',
    cat_game: '게임',
    cat_translate: '번역',
    cat_marketing: '마케팅·SNS',
    renderErr: '패널을 그리는 중 오류가 났습니다. /ai-tools를 다시 입력해 보세요.',
    paneTitle: 'AI 도구 현황',
    cmdTools: '이 PC의 스킬·플러그인과 이번 작업에서 쓴 도구를 패널로 보기',
    cmdLog: 'Claude Code 밖에서 쓴 도구를 수동 기록: /ai-log 이미지생성도구 로고 시안',
    manualNote: '(수동 기록)',
    running: (n: string) => `${n} 사용 중`,
    existsGlobal: '같은 이름이 전체 폴더에 이미 있습니다',
    unreadPath: (n: string, p: string) => `${n}: 경로를 찾을 수 없음 (${p})`,
    unreadEmpty: (n: string) => `${n}: 설명·스킬·에이전트·MCP를 찾지 못함`,
    transStatus: (a: number, b: number, c: number, d: number) => `번역 상태: 화면 문구 ${a}/${b} · 설명 ${c}/${d}`,
    retry: '다시 시도',
    usage: '사용법: /ai-log <도구> <한 일>   예) /ai-log 이미지생성도구 로고 시안',
    logged: (t: string) => `기록했습니다: ${t}`,
  },
  en: {
    used: 'Tools used and what they are for',
    none: 'Nothing yet. Entries appear as you work.',
    timeline: 'Timeline',
    noInst: 'No installed skills or plugins found.',
    skills: (n: number) => ` (${n} skills)`,
    noDesc: 'No description',
    unknown: 'No description (not found in the installed list)',
    ext: 'Outside tool (logged by hand)',
    plugin: 'plugin',
    skill: 'skill',
    opened: (n: number) => `Opened the AI tools panel. (${n} installed items read)`,
    on: 'On',
    off: 'Off',
    subPlugins: (n: number) => `Plugins (${n})`,
    subSkills: (n: number) => `Skills (${n})`,
    noneHere: 'Nothing in this section.',
    mcpGeneric: 'Tool of a connected MCP server (no description in the installed list)',
    secPlugins: (n: number) => `${n} plugins · on/off`,
    hintPlugins: 'While on, their hooks and MCP servers keep running. Skills apply only when called.',
    secSkills: (n: number) => `${n} skills · called by command`,
    hintSkills: 'Type /name to apply. They do nothing until called. (Only the description is always loaded.)',
    turnOn: 'Turn on',
    turnOff: 'Turn off',
    agentTag: 'agent',
    noParts: 'No skills, agents or MCP servers',
    nowOn: 'Turned on. Takes effect the next time Claude Code starts.',
    nowOff: 'Turned off. Takes effect the next time Claude Code starts. (Its descriptions stop being sent to the model, saving tokens.)',
    cacheTitle: (n: number) => `Old cache: ${n}`,
    cacheNone: 'No old cache to remove.',
    cacheBtn: 'Remove old cache',
    cacheAsk: (n: number) =>
      `This deletes ${n} folders. Versions currently installed or marked in use are left alone. It cannot be undone.`,
    cacheDone: (n: number) => `Removed ${n}.`,
    cacheOk: 'OK',
    cacheSkipped: (n: number) => `${n} skipped (marked in use)`,
    updateGlobal: 'Update global copy',
    tabTools: 'Tools',
    tabLog: (n: number) => (n > 0 ? `Live log (${n})` : 'Live log'),
    tabEnv: 'Environment',
    showMore: (n: number) => `▾ Show ${n} more`,
    showLess: '▴ Show less',
    env: 'Detected environment',
    envRoot: 'Config folder',
    envCount: (p: number, s: number, m: number) => `Read: ${p} plugins · ${s} skills · ${m} MCP servers`,
    cliOk: 'available',
    cliNo: 'not found (needed for global install and marketplace registration)',
    envNone: 'Nothing was read from the config folder. Check CLAUDE_CONFIG_DIR or your user folder.',
    unreadHead: 'Could not read',
    langLabel: 'Language',
    scopeAll: 'everywhere',
    scopeFolder: (p: string) => `folder ${p}`,
    folderOnly: 'Tools that only work in one folder',
    noFolder: (n: number) => `No folder-only tools. (${n} projects checked)`,
    alreadyGlobal: 'Already available everywhere (nothing to move)',
    toGlobal: 'Move to global',
    askCopy: 'Copy it so it works in every folder? The original stays.',
    yes: 'Yes',
    cancel: 'Cancel',
    copied: 'Copied to global. The original is still there.',
    removeOrig: 'Delete original',
    askRemove: 'Delete the original? This cannot be undone.',
    removed: 'Move finished. (original deleted)',
    manualOff: 'Turn it off in that folder\'s settings yourself.',
    modLabel: 'mod (this session only)',
    askMod: 'Copy it to ~/.claude/local-mods and install it for every project? Later edits to the original are not synced.',
    modKeep: 'The original in the session folder is untouched. The global install is used from the next session.',
    allOn: 'Turn all on',
    allOff: 'Turn all off',
    groupOn: 'Turn this group on',
    groupOff: 'Turn this group off',
    bulkAskOn: (n: number) => `This turns ${n} plugins on. It takes effect the next time Claude Code starts. Continue?`,
    bulkAskOff: (n: number) =>
      `This turns ${n} plugins off. It takes effect the next time Claude Code starts, and you can turn them back on. This plugin (ai-tool-tracker) is not turned off. Continue?`,
    bulkRun: (i: number, n: number) => `Working… ${i}/${n}`,
    bulkDone: (n: number) => `Changed ${n}. It takes effect the next time Claude Code starts.`,
    catg_video: 'Video',
    catg_captions: 'Captions & voice',
    catg_image: 'Images & design',
    catg_planning: 'Planning & docs',
    catg_web: 'Web & browser',
    catg_dev: 'Dev & deploy',
    catg_data: 'Data & databases',
    catg_security: 'Security',
    catg_files: 'Files & cloud',
    catg_marketing: 'Marketing & social',
    catg_other: 'Other',
    recoPick: (n: number) => `Pick #${n}`,
    recoTop: (n: number) => `Recommended · the ${n} with the most stars`,
    recoRestShow: (n: number) => `Show the other ${n}`,
    recoRestHide: 'Hide the others',
    recoNoTop: (m: number) => `No candidate has ${m} or more stars, so nothing can be recommended. The candidates below have few stars.`,
    recoStarsUnknown: 'Star counts have not been checked yet. Check them with the button below to recommend the ones with the most stars.',
    recoStarsBtn: 'Check star counts',
    recoStarsChecking: 'Checking star counts…',
    fewStars: (n: number, m: number) =>
      `${n} stars, fewer than the minimum (${m}). Hardly anyone knows it yet, so there is little reason to trust it.`,
    starsUnknown: 'Stars: not checked yet',
    minStarsLabel: 'Minimum stars to recommend',
    minStarsHint: 'Unreviewed repositories with fewer stars than this are not recommended. 0 turns the check off.',
    agTitle: 'Division of work (sub-agents by purpose)',
    agHint: 'When on, each group such as Video or Dev gets its own sub-agent that does that work on the model and token budget you set. It adds a little to the agent list every turn, so it is off by default. Changes apply from the next turn. Type a value in a field and press Enter.',
    guardDeny: (label: string, p: number, g: number) =>
      `${label} usage is ${p}% (protection threshold ${g}%), so no new sub-agent was started. Try again after the reset, or raise the threshold in the Environment tab.`,
    spawnCap: (n: number) => `Only ${n} sub-agents are started per request. Do the rest in the next request.`,
    agGuard: 'Usage protection',
    agGuardOff: 'not used',
    agGuardHint: 'Choose the 5-hour and the weekly (7-day) thresholds separately. No new sub-agent is started when that usage is at or above its percentage. You cannot turn both off.',
    tabMode: 'Work modes',
    prTitle: 'Work modes',
    prHint: 'Turns on only the plugins that fit what you are about to do and turns the rest off. It shows what will change and asks first.',
    prBuiltin: 'Built-in modes',
    pr_video: 'Video work',
    pr_docs: 'Docs & planning',
    pr_web: 'Web & dev',
    pr_data: 'Data work',
    prMineTitle: 'My presets',
    prEmpty: 'None yet. Type a name below to make one from the plugins that are on now, or use "Copy to my presets" on a built-in mode.',
    prNewLabel: 'New preset name:',
    prNewHint: 'made from the plugins that are on now (Enter)',
    prFull: (n: number) => `You can have up to ${n} presets. Delete one you do not use first.`,
    prCount: (n: number) => `${n} plugins`,
    prSame: 'same as now',
    prApply: 'Apply',
    prEdit: 'Edit',
    prRename: 'Rename',
    prDelete: 'Delete',
    prCopy: 'Copy to my presets',
    prNameLabel: 'Name:',
    prDelAsk: (name: string) => `Delete the preset "${name}"? The plugins themselves are not deleted.`,
    prEditHint: 'Press to add or remove. The ones marked ✓ are kept on when this preset is applied.',
    prOverwrite: 'Overwrite with what is on now',
    prEditDone: 'Done',
    prNothing: 'Already the same as this mode.',
    prAsk: (label: string, on: number, off: number) => `"${label}": turn on ${on} and turn off ${off}. Go ahead?`,
    prAskSave: (label: string, on: number, off: number, tok: string) =>
      `"${label}": turn on ${on} and turn off ${off} (saves about ${tok} always-loaded tokens). Go ahead?`,
    prRun: (i: number, n: number) => `Applying… ${i}/${n}`,
    prDone: (n: number) => `Changed ${n}. It takes effect the next time Claude Code starts.`,
    prNote: 'The "Other" group and this plugin itself are never touched.',
    unTitle: 'Unused plugins',
    unDays: (n: number) => `${n}-day rule`,
    unLearning: (d: number, n: number) => `Collecting usage history (day ${d}). After ${n} days it will tell you which plugins went unused.`,
    unNone: (n: number) => `Every enabled plugin was used in the last ${n} days.`,
    unNever: 'no recorded use',
    unAgo: (d: number) => `last used ${d} days ago`,
    unOffAll: (n: number) => `Turn off all ${n} unused`,
    unOffAllSave: (n: number, t: string) => `Turn off all ${n} unused (saves about ${t} tokens)`,
    unNote: 'Only the plugin name, the time of its last use and a count are stored on this PC. A newly installed plugin may simply not have been used yet, and plugins that help without being called (themes, for example) can look unused, so check before turning one off.',
    tokAlways: (t: string) => `always ~${t} tokens`,
    tokOffNote: 'off, so it uses no tokens',
    tokTotal: (t: string, n: number) => `Loaded up front in every conversation by ${n} enabled plugins: about ${t} tokens`,
    tokNote: '"Always" is an estimate of the descriptions sent every conversation even if unused. It is not what was actually used; turning a plugin off removes it.',
    usTitle: 'Usage',
    usFive: '5 hours',
    usSeven: '7 days',
    usCtx: 'Conversation',
    usCost: 'This session',
    usResetH: (h: number, m: number) => `resets in ${h}h ${m}m`,
    usResetM: (m: number) => `resets in ${m}m`,
    usNone: 'No usage information yet. It appears after the first response.',
    usNote: 'Percentages reported by Claude Code. The exact token count is not published.',
    usAdvMid: 'You have used over half. Hand light tasks to Haiku in Division of work to save some.',
    usAdvHigh: 'Close to the limit. Put big jobs off until the reset, or run them on Haiku with a low token budget.',
    usAdvFull: 'Almost used up. Wait for the reset or do only very light work.',
    usToast: (p: string) => `5-hour usage is ${p}%. Check Usage in the panel before big jobs.`,
    agRegFail: (label: string) => `Could not register the ${label} sub-agent. Check the model ID in the Environment tab.`,
    agModel: 'Model',
    agModelCustom: 'Custom model ID:',
    agRange: (min: string, max: string) => `${min} to ${max} (e.g. 150k)`,
    agAdjusted: (min: string, max: string, v: string) => `Outside the range this model allows (${min} to ${max}), so it was set to ${v}.`,
    agBad: 'That value could not be read, so it was not saved.',
    agBudget: 'Token budget',
    agTurns: 'Max turns',
    agNoLimit: 'No limit',
    agInherit: 'Same as now',
    agUsed: (runs: number, tokens: string) => `This session: ${runs} runs · ${tokens} tokens`,
    agOver: (label: string, used: string, budget: string) =>
      `The ${label} group reached its token budget (${budget}, used ${used}), so no new sub-agent was started. You can raise the budget in the Environment tab.`,
    agNone: 'No groups to hand work to yet. They appear here once plugins are grouped by purpose in the Tools tab.',
    agLine: (model: string, budget: string, used: string) => `Sub-agent: ${model} · budget ${budget} · used ${used}`,
    agLimitNote: 'The budget is checked when a new sub-agent starts. A running one is not cut off midway; its length is limited by "Max turns". A sub-agent uses about 60k tokens just to start, so budgets are accepted only within a range set per model (at least 100k); pricier models have a lower maximum.',
    tabReco: (n: number) => (n > 0 ? `Suggestions (${n})` : 'Suggestions'),
    recoTitle: 'How about these tools?',
    recoNone: 'Nothing to suggest yet. Ask for something like "make a video", or search with /ai-find video.',
    recoTopic: (c: string, t: string) => `Detected topic: ${c} · search: ${t}`,
    recoTopicFree: (t: string) => `Search: ${t}`,
    recoLocalNone: 'No matching plugin found in the directory.',
    recoGithubTitle: 'Live GitHub search',
    recoGithubBtn: (t: string) => `Search GitHub for more: ${t}`,
    recoSending: (t: string) =>
      `Pressing sends the search word "${t}" and the names (owner/repo) of the repositories above to GitHub. Your conversation is not sent.`,
    recoSearching: 'Searching GitHub…',
    recoGhNone: 'No matching repository found on GitHub.',
    recoGhErr: (m: string) => `GitHub search failed: ${m}`,
    tier_official: 'Official marketplace',
    tier_anthropic: 'Reviewed by Anthropic',
    tier_partner: 'Reviewed (partner)',
    tier_added: 'A marketplace you added',
    tier_listed: 'Listed in directory · not reviewed',
    tier_github: 'Unverified source (GitHub search)',
    flag_stale: 'Not updated for over a year',
    flag_fresh: 'Repository is less than 30 days old',
    flag_noLicense: 'No license',
    flag_fork: 'This is a fork of another repository',
    flag_ratio: 'Very few forks for its star count. Do not trust the star count',
    ownerLabel: 'Owner',
    noCmd: 'The name has special characters, so no install command was generated. Follow the repository instructions.',
    trustNote: 'The labels are a hint, not a guarantee of safety. Before installing, check that the owner is right and read the repository code and the permissions it asks for.',
    recoInstalled: 'installed',
    recoWarn: 'This repository has not been reviewed. Check its code and permissions yourself before installing.',
    recoCopy: 'Copy install command',
    recoCopied: 'Command copied.',
    recoOpen: 'Open link',
    recoToast: (n: number, c: string) => `${n} suggested tools for '${c}' — see the Suggestions tab`,
    findUsage: 'Usage: /ai-find <what you want to do>   e.g. /ai-find video production',
    findStarted: (t: string) => `Searching for "${t}". See the Suggestions tab. (These search words were also sent to GitHub.)`,
    cat_video: 'video',
    cat_image: 'images',
    cat_slides: 'slides',
    cat_website: 'websites',
    cat_design: 'design',
    cat_docs: 'documents',
    cat_audio: 'music and voice',
    cat_data: 'charts and data',
    cat_testing: 'testing',
    cat_git: 'git and GitHub',
    cat_db: 'databases',
    cat_game: 'games',
    cat_translate: 'translation',
    cat_marketing: 'marketing and social media',
    renderErr: 'The panel hit an error while drawing. Try /ai-tools again.',
    paneTitle: 'AI tools',
    cmdTools: 'Show installed skills and plugins and the tools used in this work in a panel',
    cmdLog: 'Log a tool you used outside Claude Code by hand: /ai-log image-tool logo draft',
    manualNote: '(logged by hand)',
    running: (n: string) => `${n} running`,
    existsGlobal: 'A copy with the same name already exists in the global folder',
    unreadPath: (n: string, p: string) => `${n}: path not found (${p})`,
    unreadEmpty: (n: string) => `${n}: no description, skills, agents or MCP found`,
    transStatus: (a: number, b: number, c: number, d: number) => `Translation: UI ${a}/${b} · descriptions ${c}/${d}`,
    retry: 'Try again',
    usage: 'Usage: /ai-log <tool> <what you did>   e.g. /ai-log image-tool logo draft',
    logged: (t: string) => `Logged: ${t}`,
  },
}
// ko/en 외의 언어: 영어 문구를 번역해 둔 것을 쓰고, 아직 없는 문구는 영어로 보인다
const SENT = ['{0}', '{1}', '{2}', '{3}']
const uiTemplates = (): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(UI.en as Record<string, unknown>)) {
    if (typeof v === 'function') {
      out[k] = k === 'tabLog' ? 'Live log ({0})' : k === 'tabReco' ? 'Suggestions ({0})' : (v as any)(...SENT)
    }
    else out[k] = String(v)
  }
  return out
}
const fill = (t: string, a: unknown[]) => t.replace(/\{(\d)\}/g, (_, i) => String(a[Number(i)] ?? ''))
const uiTr: Record<string, Record<string, string>> = {}
const uiObj: Record<string, any> = {}
const buildUi = (L: string) => {
  const tr = uiTr[L] ?? {}
  const base: any = UI.en
  const o: any = {}
  for (const k of Object.keys(base)) {
    const tmpl = tr[k]
    if (typeof base[k] === 'function') {
      o[k] = tmpl
        ? (...a: unknown[]) => {
            const s = fill(tmpl, a)
            return (k === 'tabLog' || k === 'tabReco') && Number(a[0]) === 0 ? s.replace(/\s*[(（]\s*0\s*[)）]/, '') : s
          }
        : base[k]
    } else {
      o[k] = tmpl ?? base[k]
    }
  }
  return (uiObj[L] = o)
}
const ui = (): any => (lang === 'ko' ? UI.ko : lang === 'en' ? UI.en : (uiObj[lang] ?? UI.en))

const srcOf = (text: string) => (/[가-힣]/.test(text) ? 'ko' : 'en')
const tx = (text: string) => (srcOf(text) === lang ? text : (tmaps[lang]?.[text] ?? text))
const roleOf = (c: { key: string; role: string }) =>
  lang === 'ko' ? c.role : tx(ROLE_EN[c.key] ?? c.role)
const catLabel = (c: { key: string; label: string }) =>
  lang === 'ko' ? c.label : tx(LABEL_EN[c.key] ?? c.label)

type Item = {
  /** 빈 문자열이면 전체(모든 폴더), 아니면 이 도구가 적용되는 폴더 경로 */
  where: string
  /** 플러그인 키(이름@마켓), 스킬은 빈 문자열 */
  key: string
  /** 사용자 설정에서 켜져 있는지 */
  enabled: boolean
  name: string
  kind: 'skill' | 'plugin'
  summary: string
  skills: string[]
  /** 눌러서 펼칠 때 보여줄 스킬 목록 (같은 플러그인·같은 접두어 묶음) */
  children: { name: string; summary: string }[]
  agents: string[]
  mcp: string[]
  /** 용도별 묶음 (영상, 자막·음성, 기획·문서 …) */
  cat: CatKey
}
// 특정 폴더에서만 쓸 수 있는 스킬·플러그인
type FolderItem = {
  id: string
  folder: string // 이 도구가 적용되는 프로젝트 폴더 (모드는 세션 폴더)
  kind: 'skill' | 'plugin' | 'mod'
  name: string
  summary: string
  src?: string // 스킬 폴더 경로
  key?: string // 플러그인 키 (이름@마켓)
  scope?: string // 설치 범위 (project/local), 플러그인
  canRemove: boolean
  isGlobalAlready: boolean
}
let rootDir = ''
let checkedCount = 0

// 감지한 환경 (패널 맨 아래에 보여준다)
let diag = {
  root: '',
  fromEnv: false,
  plugins: 0,
  skills: 0,
  mcp: 0,
  unread: [] as { k: string; name: string; path?: string }[],
  cli: undefined as boolean | undefined,
  oldCache: [] as { path: string; label: string }[], // 지워도 되는 옛 버전 캐시
  cacheSkipped: 0, // 사용 중 표시가 있어 건너뛴 것
}

type Index = {
  folderItems: FolderItem[]
  items: Item[]
  skillOwner: Map<string, string> // 스킬 이름(접두어 유무 모두) -> 항목 이름
}

let index: Index | undefined
let loading: Promise<Index> | undefined

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
const shorten = (s: string, n = 48) => (s.length > n ? s.slice(0, n) + '…' : s)
const safe = async <T,>(p: Promise<T>): Promise<T | undefined> =>
  p.catch(() => undefined)

// SKILL.md 맨 위 --- 블록에서 name / description 읽기 (한 줄·접힌 줄 모두)
const parseFront = (text: string): { name?: string; description?: string } => {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return {}
  const lines = m[1].split(/\r?\n/)
  const out: { name?: string; description?: string } = {}
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z][\w-]*):\s*(.*)$/)
    if (!kv) continue
    const [, key, rest] = kv
    if (key !== 'name' && key !== 'description') continue
    let v = rest.trim()
    if (v === '' || /^[>|][-+]?$/.test(v)) {
      const parts: string[] = []
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
        parts.push(lines[++i].trim())
      }
      v = parts.join(' ')
    }
    out[key] = v.replace(/^["']|["']$/g, '')
  }
  return out
}

// 설명의 첫 문장만, 한 줄로
const summarize = (desc: string): string => {
  const flat = desc.replace(/\s+/g, ' ').trim()
  const first = flat.split(/(?<=[.。!?])\s/)[0] ?? flat
  return shorten(first, 60)
}

const scan = async ($: any): Promise<Index> => {
  const cfg: string | undefined = await $.env.get('CLAUDE_CONFIG_DIR')
  const home: string =
    (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
  const root = norm(cfg ?? `${home}/.claude`)

  const items: Item[] = []
  const skillOwner = new Map<string, string>()

  // dir 아래 */SKILL.md 를 모두 읽어 { 스킬이름, 요약 } 목록으로
  const readSkills = async (dir: string) => {
    const entries: any[] = (await safe($.fs.list(dir))) ?? []
    const found = await Promise.all(
      entries
        .filter(en => en.kind !== 'file')
        .map(async en => {
          const text: string | undefined = await safe(
            $.fs.read(`${dir}/${en.name}/SKILL.md`),
          )
          if (!text) return undefined
          const fm = parseFront(text)
          return { name: fm.name ?? en.name, dir: en.name as string, summary: summarize(fm.description ?? ''), desc: clean(fm.description ?? '', 300) }
        }),
    )
    return found.filter((x): x is { name: string; dir: string; summary: string; desc: string } => !!x)
  }

  // 플러그인의 스킬: skills/ 아래, 없으면 플러그인 폴더 바로 아래 (구조가 다른 플러그인도 읽는다)
  const readSkillsAny = async (p: string) => {
    const a = await readSkills(`${p}/skills`)
    return a.length > 0 ? a : readSkills(p)
  }

  // 사용자가 직접 둔 스킬: 이름 접두어(remotion-…)가 같은 것이 2개 이상이면 한 묶음으로
  const userSkills = await readSkills(`${root}/skills`)
  const byPrefix = new Map<string, typeof userSkills>()
  for (const s of userSkills) {
    const pre = s.name.split('-')[0]
    byPrefix.set(pre, [...(byPrefix.get(pre) ?? []), s])
  }
  for (const [pre, list] of byPrefix) {
    if (list.length >= 2) {
      const lead = list.find(s => s.name.includes('best-practices')) ?? list[0]
      items.push({
        where: '', key: '', enabled: true, name: pre, kind: 'skill', summary: lead.summary,
        cat: categorize({ name: pre, description: lead.desc, skills: list.map(x => ({ name: x.name, description: x.desc })) }),
        skills: list.map(s => s.name),
        children: list.map(s => ({ name: s.name, summary: s.summary })),
        agents: [], mcp: [],
      })
      for (const s of list) skillOwner.set(s.name, pre)
    } else {
      const s = list[0]
      items.push({
        where: '', key: '', enabled: true, name: s.name, kind: 'skill', summary: s.summary,
        cat: categorize({ name: s.name, description: s.desc, skills: [] }),
        skills: [s.name], children: [], agents: [], mcp: [],
      })
      skillOwner.set(s.name, s.name)
    }
  }
  const unread: { k: string; name: string; path?: string }[] = []

  // 설치된 플러그인
  const raw: string | undefined = await safe($.fs.read(`${root}/plugins/installed_plugins.json`))
  let installed: Record<string, any[]> = {}
  try {
    installed = raw ? (JSON.parse(raw).plugins ?? {}) : {}
  } catch {
    installed = {}
  }

  // 사용자 설정에서 켜진/꺼진 플러그인 (끄면 false가 기록된다)
  let enabledMap: Record<string, boolean> = {}
  try {
    const st: string | undefined = await safe($.fs.read(`${root}/settings.json`))
    enabledMap = st ? (JSON.parse(st).enabledPlugins ?? {}) : {}
  } catch {}

  const plugins = await Promise.all(
    Object.entries(installed).map(async ([key, arr]) => {
      const entry = arr?.[arr.length - 1]
      if (!entry?.installPath) return undefined
      const p = norm(entry.installPath)
      const name = key.split('@')[0]
      if (!(await safe($.fs.exists(p)))) {
        unread.push({ k: 'path', name, path: p })
        return undefined
      }

      let desc = ''
      for (const f of [`${p}/.claude-plugin/plugin.json`, `${p}/plugin.json`]) {
        const t: string | undefined = await safe($.fs.read(f))
        if (!t) continue
        try {
          desc = JSON.parse(t).description ?? ''
        } catch {}
        break
      }

      const skills = await readSkillsAny(p)

      const agentEntries: any[] = (await safe($.fs.list(`${p}/agents`))) ?? []
      const agents = agentEntries
        .filter(a => a.kind === 'file' && a.name.endsWith('.md'))
        .map(a => a.name.replace(/\.md$/, ''))

      let mcp: string[] = []
      for (const f of [`${p}/.mcp.json`, `${p}/mcp.json`]) {
        const t: string | undefined = await safe($.fs.read(f))
        if (!t) continue
        try {
          const j = JSON.parse(t)
          mcp = Object.keys(j.mcpServers ?? j)
        } catch {}
        break
      }

      if (!desc && skills.length === 0 && agents.length === 0 && mcp.length === 0) {
        unread.push({ k: 'empty', name })
      }
      const summary = summarize(desc) || skills[0]?.summary || ''
      const where =
        entry.scope && entry.scope !== 'user' && entry.projectPath ? norm(entry.projectPath) : ''
      return { name, key, enabled: enabledMap[key] === true, summary, skills, agents, mcp, where, desc }
    }),
  )

  for (const pl of plugins) {
    if (!pl) continue
    items.push({
      where: pl.where,
      key: pl.key,
      enabled: pl.enabled,
      name: pl.name,
      kind: 'plugin',
      cat: categorize({
        name: pl.name,
        description: clean(pl.desc, 300),
        skills: pl.skills.map(x => ({ name: x.name, description: x.desc })),
        agents: pl.agents.map(a => ({ name: a })),
      }),
      summary: pl.summary,
      skills: pl.skills.map(s => s.name),
      children: pl.skills.map(s => ({ name: s.name, summary: s.summary })),
      agents: pl.agents,
      mcp: pl.mcp,
    })
    for (const s of pl.skills) {
      skillOwner.set(s.name, pl.name)
      skillOwner.set(`${pl.name}:${s.name}`, pl.name)
    }
  }

  // 폴더 전용 도구 찾기: 알려진 프로젝트 폴더들을 훑는다
  rootDir = root
  const folderItems: FolderItem[] = []
  const userSkillNames = new Set(userSkills.map(s => s.name))
  const userSettings: string | undefined = await safe($.fs.read(`${root}/settings.json`))
  let userEnabled: Record<string, boolean> = {}
  try {
    userEnabled = userSettings ? (JSON.parse(userSettings).enabledPlugins ?? {}) : {}
  } catch {}
  const seen = new Set<string>()
  const pushPlugin = (folder: string, key: string, scope: string | undefined, canRemove: boolean) => {
    const id = `plugin:${folder}:${key}`
    if (seen.has(id)) return
    seen.add(id)
    const name = key.split('@')[0]
    folderItems.push({
      id, folder, kind: 'plugin', name, key, scope, canRemove,
      summary: items.find(i => i.name === name)?.summary ?? '',
      isGlobalAlready: !!userEnabled[key],
    })
  }

  // (a) 설치 기록에서 project/local 범위로 깔린 플러그인
  for (const [key, arr] of Object.entries(installed)) {
    for (const en of arr ?? []) {
      if (en.scope && en.scope !== 'user' && en.projectPath) {
        pushPlugin(norm(en.projectPath), key, en.scope, true)
      }
    }
  }

  // (b) 알려진 프로젝트 폴더의 .claude/skills 와 프로젝트 설정에서 켠 플러그인
  const cj: string | undefined = await safe(
    $.fs.read(cfg ? `${root}/.claude.json` : `${home}/.claude.json`),
  )
  let projectDirs: string[] = []
  try {
    projectDirs = cj ? Object.keys(JSON.parse(cj).projects ?? {}) : []
  } catch {}
  projectDirs = projectDirs
    .map(norm)
    .filter(p => !p.includes('/.claude/worktrees/') && !p.includes('/scratch'))
  checkedCount = projectDirs.length

  await Promise.all(
    projectDirs.map(async p => {
      for (const s of await readSkills(`${p}/.claude/skills`)) {
        const id = `skill:${p}:${s.name}`
        if (seen.has(id)) continue
        seen.add(id)
        folderItems.push({
          id, folder: p, kind: 'skill', name: s.name, summary: s.summary,
          src: `${p}/.claude/skills/${s.dir}`, canRemove: true,
          isGlobalAlready: userSkillNames.has(s.name),
        })
      }
      for (const f of ['settings.json', 'settings.local.json']) {
        const t: string | undefined = await safe($.fs.read(`${p}/.claude/${f}`))
        if (!t) continue
        try {
          const en: Record<string, boolean> = JSON.parse(t).enabledPlugins ?? {}
          for (const [k, on] of Object.entries(en)) if (on) pushPlugin(p, k, undefined, false)
        } catch {}
      }
    }),
  )

  // (c) 세션 전용 폴더(dev-mods/<세션>/<모드>)에 있는 모드: 그 세션에서만 불러와진다
  const installedUser = new Set(
    Object.entries(installed)
      .filter(([, arr]) => (arr ?? []).some(en => en.scope === 'user'))
      .map(([k]) => k.split('@')[0]),
  )
  const sessions: any[] = (await safe($.fs.list(`${root}/dev-mods`))) ?? []
  await Promise.all(
    sessions
      .filter(s => s.kind !== 'file')
      .map(async s => {
        const mods: any[] = (await safe($.fs.list(`${root}/dev-mods/${s.name}`))) ?? []
        for (const m of mods.filter(x => x.kind !== 'file')) {
          const dir = `${root}/dev-mods/${s.name}/${m.name}`
          const t: string | undefined = await safe($.fs.read(`${dir}/.claude-plugin/plugin.json`))
          if (!t) continue
          try {
            const j = JSON.parse(t)
            const name: string = j.name ?? m.name
            folderItems.push({
              id: `mod:${dir}`, folder: `${root}/dev-mods/${s.name}`, kind: 'mod', name,
              summary: summarize(j.description ?? ''), src: dir, canRemove: false,
              isGlobalAlready: installedUser.has(name),
            })
          } catch {}
        }
      }),
  )

  // 옛 캐시 찾기: cache/<마켓>/<플러그인>/<버전> 중 설치 기록이 가리키지 않고, 사용 중 표시(.in_use)가 없는 것
  const refs = new Set<string>()
  for (const arr of Object.values(installed)) {
    for (const en of arr ?? []) if (en.installPath) refs.add(norm(en.installPath).toLowerCase())
  }
  const oldCache: { path: string; label: string }[] = []
  let cacheSkipped = 0
  const mkts: any[] = (await safe($.fs.list(`${root}/plugins/cache`))) ?? []
  for (const m of mkts.filter(x => x.kind !== 'file')) {
    const plugs: any[] = (await safe($.fs.list(`${root}/plugins/cache/${m.name}`))) ?? []
    for (const pl of plugs.filter(x => x.kind !== 'file')) {
      const vers: any[] = (await safe($.fs.list(`${root}/plugins/cache/${m.name}/${pl.name}`))) ?? []
      for (const v of vers.filter(x => x.kind !== 'file')) {
        const path = `${root}/plugins/cache/${m.name}/${pl.name}/${v.name}`
        if (refs.has(path.toLowerCase())) continue
        const inUse: any[] = (await safe($.fs.list(`${path}/.in_use`))) ?? []
        if (inUse.length > 0) {
          cacheSkipped++
          continue
        }
        oldCache.push({ path, label: `${pl.name} ${v.name}` })
      }
    }
  }

  // 감지한 환경 기록
  const cli: boolean = await $.process
    .run(['claude', '--version'], { timeoutMs: 15000 })
    .then((r: any) => r.exitCode === 0)
    .catch(() => false)
  diag = {
    root,
    fromEnv: !!cfg,
    plugins: items.filter(i => i.kind === 'plugin').length,
    skills: items.reduce((n, i) => n + i.skills.length, 0),
    mcp: items.reduce((n, i) => n + i.mcp.length, 0),
    unread,
    cli,
    oldCache,
    cacheSkipped,
  }

  return { items, skillOwner, folderItems }
}

const ensure = ($: any): Promise<Index> => {
  if (index) return Promise.resolve(index)
  loading ??= scan($)
    .then(i => (index = i))
    .catch(() => (index = { items: [], skillOwner: new Map(), folderItems: [] }))
  return loading
}

// 화면 문구 번역: 저장된 것은 검사해서 쓰고, 없는 것만 모델로 번역한다
const translateUi = async ($: any, L: string) => {
  const tmpl = uiTemplates()
  const cur: Record<string, string> = (uiTr[L] ??= {})
  const slotsOk = (src: string, v: string) => (src.match(/\{\d\}/g) ?? []).every(p => v.includes(p))
  // 'OK'처럼 짧은 영어가 그대로여도 정상으로 본다 (그 언어에서도 같은 표기를 쓰는 말)
  const accept = (src: string, v: string) =>
    slotsOk(src, v) && (looksLike(L, v) || (v === src && /^[A-Za-z .]{1,6}$/.test(src)))

  // 번역은 영어 원문(s)과 함께 저장한다. 원문이 바뀌면 옛 번역을 버리고 다시 번역한다.
  const pack = () => Object.fromEntries(Object.entries(cur).map(([k, t]) => [k, { s: tmpl[k], t }]))
  const saved = await safe($.store.get(`ui2-${L}`))
  if (saved && typeof saved === 'object') {
    for (const [k, v] of Object.entries(saved as Record<string, any>)) {
      if (k in tmpl && v && typeof v.t === 'string' && v.s === tmpl[k] && accept(tmpl[k], v.t)) cur[k] = v.t
    }
  }
  buildUi(L)
  await update($, uses, l => [...l])

  const need = Object.keys(tmpl).filter(k => !cur[k])
  for (let i = 0; i < need.length; i += 40) {
    const chunk = need.slice(i, i + 40)
    const r = await $.model.complete({
      model: 'haiku',
      effort: 'low',
      maxTokens: 4000,
      timeoutMs: 60000,
      prompt:
        `Translate each UI string in this JSON array into ${LANG_NAME[L] ?? 'English'}. ` +
        `Keep placeholders such as {0}, {1}, {2} exactly as written. ` +
        `Keep symbols (● ▸ ▾ ▴ ⚠ ·), slash commands such as /ai-log and /ai-tools, file paths and product names unchanged. ` +
        `Reply with ONLY a JSON array of the same length and order.\n\n${JSON.stringify(chunk.map(k => tmpl[k]))}`,
    })
    if (!r.isAnswered) break
    try {
      const s: string = r.text
      const out = JSON.parse(s.slice(s.indexOf('['), s.lastIndexOf(']') + 1))
      if (Array.isArray(out) && out.length === chunk.length) {
        chunk.forEach((k, j) => {
          const v = out[j]
          if (typeof v === 'string' && accept(tmpl[k], v)) cur[k] = v
        })
      }
    } catch {}
    await safe($.store.set(`ui2-${L}`, pack()))
    buildUi(L)
    await update($, uses, l => [...l])
  }
}

// 다른 언어의 설명을 한 번만 번역해 저장 (저장된 건 다시 부르지 않음)
const translateAll = async ($: any, idx: Index) => {
  // 시작할 때의 언어를 고정해서 쓴다. 번역하는 도중 언어가 바뀌어도 이 작업은 끝까지 이 언어만 다룬다.
  const L = lang
  const map: Record<string, string> = (tmaps[L] ??= {})

  if (!loadedLangs.has(L)) {
    loadedLangs.add(L)
    const saved = await safe($.store.get(`tr-${L}`))
    if (saved && typeof saved === 'object') {
      // 저장된 번역 중 그 언어가 아닌 글자로 된 것(이전에 섞여 들어간 것)은 버린다
      let dropped = 0
      for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
        if (typeof v === 'string' && looksLike(L, v)) map[k] = v
        else dropped++
      }
      if (dropped > 0) await safe($.store.set(`tr-${L}`, map)) // 깨끗한 것만 다시 저장
    }
  }

  const texts = new Set<string>(recoTexts) // 추천 설명도 같이 번역
  for (const it of idx.items) {
    if (it.summary) texts.add(it.summary)
    for (const c of it.children) if (c.summary) texts.add(c.summary)
  }
  if (L !== 'ko' && L !== 'en') {
    for (const c of CATALOG) {
      texts.add(ROLE_EN[c.key])
      if (LABEL_EN[c.key]) texts.add(LABEL_EN[c.key])
    }
  }
  const need = [...texts].filter(t => t && srcOf(t) !== L && !map[t])

  // 화면 문구(버튼, 제목, 안내)도 같은 방식으로 번역한다
  if (L !== 'ko' && L !== 'en') await translateUi($, L)

  for (let i = 0; i < need.length; i += 30) {
    const chunk = need.slice(i, i + 30)
    const r = await $.model.complete({
      model: 'haiku',
      effort: 'low',
      maxTokens: 4000,
      timeoutMs: 60000,
      prompt:
        `Translate each string in this JSON array into ${LANG_NAME[L] ?? 'English'}. ` +
        `Keep product names, plugin names and code identifiers unchanged. ` +
        `Reply with ONLY a JSON array of the same length and order.\n\n${JSON.stringify(chunk)}`,
    })
    if (!r.isAnswered) break
    try {
      const s: string = r.text
      const out = JSON.parse(s.slice(s.indexOf('['), s.lastIndexOf(']') + 1))
      if (Array.isArray(out) && out.length === chunk.length) {
        chunk.forEach((t, j) => {
          // 그 언어의 글자로 된 결과만 받는다
          if (typeof out[j] === 'string' && looksLike(L, out[j])) map[t] = out[j]
        })
      }
    } catch {}
    await safe($.store.set(`tr-${L}`, map))
    await update($, uses, l => [...l]) // 패널 다시 그리기
  }
}

// ---------------------------------------------------------------------------
// 폴더 전용 도구를 전체로 옮기기: 복사 -> (따로 확인) -> 원본 삭제
// ---------------------------------------------------------------------------
const setMove = ($: any, id: string, state: string) =>
  update($, moves, m => ({ ...m, [id]: state }))

const isWindows = async ($: any) => (await $.env.get('OS')) === 'Windows_NT'
const win = (p: string) => p.split('/').join('\\')

const doCopy = async ($: any, f: FolderItem) => {
  try {
    if (f.kind === 'skill' && f.src) {
      const dst = `${rootDir}/skills/${f.src.split('/').pop()}`
      if (await $.fs.exists(dst)) throw new Error(ui().existsGlobal)
      const w = await isWindows($)
      const argv = w
        ? ['robocopy', win(f.src), win(dst), '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP']
        : ['cp', '-R', f.src, dst]
      const r = await $.process.run(argv, { timeoutMs: 60000 })
      const ok = w ? r.exitCode < 8 : r.exitCode === 0
      if (!ok || !(await $.fs.exists(`${dst}/SKILL.md`))) {
        throw new Error((r.stderr || r.stdout || 'copy failed').trim().slice(0, 100))
      }
    } else if (f.kind === 'mod' && f.src) {
      // 세션 전용 모드 -> 로컬 마켓플레이스(~/.claude/local-mods)로 복사 후 전체 설치
      const mp = `${rootDir}/local-mods`
      const dst = `${mp}/${f.name}`
      const w = await isWindows($)
      const argv = w
        ? ['robocopy', win(f.src), win(dst), '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP']
        : ['cp', '-R', f.src, dst]
      const c = await $.process.run(argv, { timeoutMs: 60000 })
      if (!(w ? c.exitCode < 8 : c.exitCode === 0)) throw new Error((c.stderr || c.stdout || 'copy failed').trim().slice(0, 100))

      // 이미 전체 설치돼 있으면 같은 버전으로는 갱신되지 않으므로, 복사본의 버전만 올린다 (원본은 그대로)
      let instVer: string | undefined
      try {
        const rawInst: string | undefined = await safe($.fs.read(`${rootDir}/plugins/installed_plugins.json`))
        const arr = rawInst ? JSON.parse(rawInst).plugins?.[`${f.name}@local-mods`] : undefined
        instVer = arr?.[arr.length - 1]?.version
      } catch {}
      if (instVer) {
        const m = instVer.match(/^(\d+)\.(\d+)\.(\d+)/)
        const pj = `${dst}/.claude-plugin/plugin.json`
        if (m) {
          const j = JSON.parse(await $.fs.read(pj))
          j.version = `${m[1]}.${m[2]}.${Number(m[3]) + 1}`
          await $.fs.write(pj, JSON.stringify(j, null, 2))
        }
      }

      let plugins: any[] = []
      const old: string | undefined = await safe($.fs.read(`${mp}/.claude-plugin/marketplace.json`))
      try {
        plugins = old ? (JSON.parse(old).plugins ?? []) : []
      } catch {}
      plugins = [
        ...plugins.filter(p => p.name !== f.name),
        { name: f.name, source: `./${f.name}`, description: f.summary || f.name },
      ]
      await $.fs.write(
        `${mp}/.claude-plugin/marketplace.json`,
        JSON.stringify({ name: 'local-mods', owner: { name: 'local' }, plugins }, null, 2),
      )

      const add = await $.process.run(['claude', 'plugin', 'marketplace', 'add', mp, '--scope', 'user'], { timeoutMs: 120000 })
      const addOut = `${add.stderr} ${add.stdout}`
      if (add.exitCode !== 0 && !/already/i.test(addOut)) throw new Error(addOut.trim().slice(0, 100))
      const inst = await $.process.run(
        instVer
          ? ['claude', 'plugin', 'update', `${f.name}@local-mods`, '--scope', 'user', '-y']
          : ['claude', 'plugin', 'install', `${f.name}@local-mods`, '--scope', 'user'],
        { timeoutMs: 120000 },
      )
      const instOut = `${inst.stderr} ${inst.stdout}`
      if (inst.exitCode !== 0 && !/already/i.test(instOut)) throw new Error(instOut.trim().slice(0, 100))
    } else if (f.kind === 'plugin' && f.key) {
      const r = await $.process.run(['claude', 'plugin', 'install', f.key, '--scope', 'user'], {
        timeoutMs: 120000,
      })
      if (r.exitCode !== 0) throw new Error((r.stderr || r.stdout || 'install failed').trim().slice(0, 100))
    }
    await setMove($, f.id, 'copied')
    await rescan($)
    await update($, uses, l => [...l])
  } catch (err: any) {
    await setMove($, f.id, `error:${String(err?.message ?? err).slice(0, 100)}`)
  }
}

const doRemove = async ($: any, f: FolderItem) => {
  try {
    if (f.kind === 'skill' && f.src) {
      // 안전장치: <폴더>/.claude/skills/<이름> 모양이고, 전체 쪽에 복사본이 있을 때만
      const dst = `${rootDir}/skills/${f.src.split('/').pop()}`
      const isShape = /\/\.claude\/skills\/[^/]+$/.test(f.src) && !f.src.includes('..')
      if (!isShape || !(await $.fs.exists(`${dst}/SKILL.md`))) throw new Error('safety check failed')
      const w = await isWindows($)
      const argv = w ? ['cmd', '/c', 'rmdir', '/s', '/q', win(f.src)] : ['rm', '-rf', f.src]
      const r = await $.process.run(argv, { timeoutMs: 60000 })
      if (r.exitCode !== 0) throw new Error((r.stderr || r.stdout || 'delete failed').trim().slice(0, 100))
    } else if (f.kind === 'plugin' && f.key && f.scope) {
      const r = await $.process.run(['claude', 'plugin', 'uninstall', f.key, '--scope', f.scope], {
        cwd: f.folder,
        timeoutMs: 60000,
      })
      if (r.exitCode !== 0) throw new Error((r.stderr || r.stdout || 'uninstall failed').trim().slice(0, 100))
    }
    await setMove($, f.id, 'removed')
    await rescan($)
    await update($, uses, l => [...l])
  } catch (err: any) {
    await setMove($, f.id, `error:${String(err?.message ?? err).slice(0, 100)}`)
  }
}

// ---------------------------------------------------------------------------
// 옛 캐시 지우기: 지우기 직전에 설치 기록과 사용 중 표시를 다시 확인한다
// ---------------------------------------------------------------------------
const cleanCache = async ($: any) => {
  try {
    const w = await isWindows($)
    const prefix = `${rootDir}/plugins/cache/`
    const raw: string | undefined = await safe($.fs.read(`${rootDir}/plugins/installed_plugins.json`))
    const refs = new Set<string>()
    try {
      for (const arr of Object.values<any[]>(raw ? (JSON.parse(raw).plugins ?? {}) : {})) {
        for (const en of arr ?? []) if (en.installPath) refs.add(norm(en.installPath).toLowerCase())
      }
    } catch {
      throw new Error('could not read installed_plugins.json')
    }
    let n = 0
    for (const c of diag.oldCache) {
      // 안전장치: <캐시>/<마켓>/<플러그인>/<버전> 모양이어야 하고, 설치 기록이 가리키면 안 된다
      const rel = c.path.startsWith(prefix) ? c.path.slice(prefix.length).split('/') : []
      if (rel.length !== 3 || c.path.includes('..') || refs.has(c.path.toLowerCase())) continue
      const inUse: any[] = (await safe($.fs.list(`${c.path}/.in_use`))) ?? []
      if (inUse.length > 0) continue
      const r = await $.process.run(w ? ['cmd', '/c', 'rmdir', '/s', '/q', win(c.path)] : ['rm', '-rf', c.path], {
        timeoutMs: 60000,
      })
      if (r.exitCode === 0) {
        n++
        // 비어 있게 된 플러그인 폴더만 치운다 (안 비었으면 이 명령이 알아서 실패한다)
        const parent = c.path.split('/').slice(0, -1).join('/')
        await safe($.process.run(w ? ['cmd', '/c', 'rmdir', win(parent)] : ['rmdir', parent]))
      }
    }
    await setMove($, '__cache', `cacheDone:${n}`)
    await rescan($)
    await update($, uses, l => [...l])
  } catch (err: any) {
    await setMove($, '__cache', `error:${String(err?.message ?? err).slice(0, 100)}`)
  }
}

// ---------------------------------------------------------------------------
// 플러그인 켜기/끄기: claude plugin enable|disable (사용자 범위). 설정에 true/false가 기록된다.
// ---------------------------------------------------------------------------
const doToggle = async ($: any, it: Item) => {
  const id = `toggle:${it.key}`
  try {
    const r = await $.process.run(
      ['claude', 'plugin', it.enabled ? 'disable' : 'enable', it.key, '--scope', 'user'],
      { timeoutMs: 60000 },
    )
    if (r.exitCode !== 0) throw new Error((r.stderr || r.stdout || 'failed').trim().slice(0, 100))
    await setMove($, id, 'changed')
    await rescan($)
    await update($, uses, l => [...l])
  } catch (err: any) {
    await setMove($, id, `error:${String(err?.message ?? err).slice(0, 100)}`)
  }
}

// ---------------------------------------------------------------------------
// 추천: 요청에서 주제를 감지 -> 이 PC의 플러그인 디렉터리에서 찾기 -> (눌렀을 때만) GitHub 검색
// 프롬프트 원문은 어디에도 저장·전송하지 않는다. 감지한 주제와 검색어만 쓴다.
// ---------------------------------------------------------------------------
type Cat = { key: string; triggers: string[]; terms: string[] }
const CATS: Cat[] = [
  { key: 'video', triggers: ['동영상', '영상', '비디오', 'video', 'mp4', '애니메이션', 'animation'], terms: ['video', 'remotion', 'animation', 'motion'] },
  { key: 'image', triggers: ['이미지', '사진', '일러스트', '로고', 'image', 'logo', 'illustration'], terms: ['image', 'illustration', 'logo'] },
  { key: 'slides', triggers: ['ppt', '슬라이드', '발표', '프레젠테이션', 'presentation', 'slides'], terms: ['slides', 'presentation', 'pptx'] },
  { key: 'website', triggers: ['웹사이트', '홈페이지', '랜딩', '웹페이지', 'website', 'landing page'], terms: ['website', 'landing', 'frontend'] },
  { key: 'design', triggers: ['디자인', '피그마', 'figma', 'ui', 'ux'], terms: ['design', 'figma', 'ui'] },
  { key: 'docs', triggers: ['워드', 'docx', 'pdf', '엑셀', '스프레드시트', 'xlsx'], terms: ['pdf', 'docx', 'xlsx'] },
  { key: 'audio', triggers: ['음악', '음성', '목소리', '자막', 'tts', 'audio', 'music', 'voice', 'caption'], terms: ['audio', 'music', 'voice', 'caption'] },
  { key: 'data', triggers: ['차트', '그래프', '대시보드', '데이터 분석', 'chart', 'dashboard', 'analytics'], terms: ['chart', 'dashboard', 'analytics'] },
  { key: 'testing', triggers: ['tdd', 'debug', '디버깅'], terms: ['testing', 'tdd', 'debugging'] },
  { key: 'git', triggers: ['깃허브', 'github', '커밋', 'pull request'], terms: ['github', 'git', 'pull request'] },
  { key: 'db', triggers: ['데이터베이스', 'sql', 'database'], terms: ['database', 'sql'] },
  { key: 'game', triggers: ['게임', 'game'], terms: ['game'] },
  { key: 'translate', triggers: ['번역', '다국어', 'translate', 'i18n'], terms: ['translation', 'i18n'] },
  { key: 'marketing', triggers: ['마케팅', '유튜브', '인스타', 'seo', 'youtube', 'marketing'], terms: ['marketing', 'youtube', 'seo'] },
]
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// 짧은 영어는 단어 경계로 (ui가 build 안에서 걸리지 않게), 한글은 부분 일치
const hit = (text: string, t: string) =>
  /^[a-z0-9 .]+$/i.test(t) ? new RegExp(`\\b${esc(t)}\\b`, 'i').test(text) : text.includes(t)
// 맞는 주제를 전부 찾는다 ("동영상과 pdf"면 video와 docs 둘 다). 많이 맞은 순으로 최대 3개.
const detectCats = (text: string): Cat[] =>
  CATS.map(c => ({ c, n: c.triggers.filter(t => hit(text, t)).length }))
    .filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map(x => x.c)

// 디렉터리 항목: 플러그인 디렉터리 캐시 + 추가한 마켓플레이스 목록
// 목록의 이름·설명·주소는 모두 남이 쓴 글이다. 화면에는 clean으로, 명령에는 safeName/safeRepo로만 쓴다.
type DirEntry = { name: string; lname: string; summary: string; lsum: string; repo: string; tier: Tier; cmd: string }
let dirIndex: DirEntry[] | undefined
const dirByRepo = new Map<string, DirEntry>() // owner/repo(소문자) -> 디렉터리 항목: GitHub 결과의 출처를 교차 확인하는 데 쓴다
const recoTexts = new Set<string>() // 번역할 추천 설명

// 설치(또는 마켓플레이스 추가) 명령. 허용한 글자만 쓰고, 안전하지 않으면 명령을 만들지 않는다
const installCmd = (name: string, mkt: string, repo: string): string => {
  const n = safeName(name)
  const m = safeName(mkt)
  if (n && m) return `claude plugin install ${n}@${m}`
  const r = safeRepo(repo)
  return r ? `claude plugin marketplace add ${r}` : ''
}
const higher = (a: Tier, b: Tier): Tier => (tierRank(a) >= tierRank(b) ? a : b)

const loadDir = async ($: any): Promise<DirEntry[]> => {
  if (dirIndex) return dirIndex
  await ensure($)
  const out = new Map<string, DirEntry>()
  const catalogMkt = new Map<string, string>() // 플러그인 이름(소문자) -> 마켓플레이스 이름

  // 추가한 마켓플레이스 목록: 공식 마켓플레이스는 가장 높은 등급, 내가 직접 추가한 것은 그다음 등급
  const mkts: any[] = (await safe($.fs.list(`${rootDir}/plugins/marketplaces`))) ?? []
  for (const m of mkts.filter(x => x.kind !== 'file')) {
    const t: string | undefined = await safe($.fs.read(`${rootDir}/plugins/marketplaces/${m.name}/.claude-plugin/marketplace.json`))
    if (!t) continue
    try {
      for (const p of JSON.parse(t).plugins ?? []) {
        if (!p?.name || typeof p.name !== 'string') continue
        const ln = p.name.toLowerCase()
        if (!catalogMkt.has(ln)) catalogMkt.set(ln, m.name)
        const src = typeof p.source === 'object' && p.source ? p.source : {}
        // 주소는 믿지 않고 owner/repo만 검증해서 뽑는다 (임의의 homepage·http 주소는 쓰지 않는다)
        const repo = safeRepo(src.repo) || repoFromUrl(src.url) || repoFromUrl(p.homepage)
        const summary = clean(p.description, 300)
        out.set(ln, {
          name: p.name, lname: ln, summary, lsum: summary.toLowerCase(), repo,
          tier: m.name === 'claude-plugins-official' ? 'official' : 'added',
          cmd: installCmd(p.name, m.name, repo),
        })
      }
    } catch {}
  }

  // 플러그인 디렉터리 캐시: 이름, 한 줄 설명, GitHub 주소, 누가 검토했는지
  const raw: string | undefined = await safe($.fs.read(`${rootDir}/plugins/plugin-directory-cache-v2.json`))
  if (raw) {
    try {
      for (const l of JSON.parse(raw).listings ?? []) {
        if (!l?.name || typeof l.name !== 'string' || (l.surfaces && !l.surfaces.includes('claude_code'))) continue
        const ln = l.name.toLowerCase()
        const repo = repoFromUrl(l.source?.repository?.url)
        const prev = out.get(ln)
        const summary = clean(l.summary ?? prev?.summary, 300)
        const mk = catalogMkt.get(ln)
        const reviewTier = tierFromReview(l.checks?.review?.state, l.checks?.review?.by?.type)
        out.set(ln, {
          name: l.name, lname: ln, summary, lsum: summary.toLowerCase(), repo: repo || prev?.repo || '',
          tier: prev ? higher(prev.tier, reviewTier) : reviewTier,
          cmd: prev?.cmd || installCmd(l.name, mk ?? '', repo),
        })
      }
    } catch {}
  }

  const list = [...out.values()]
  for (const e of list) {
    if (!e.repo) continue
    const k = e.repo.toLowerCase()
    const old = dirByRepo.get(k)
    if (!old || tierRank(e.tier) > tierRank(old.tier)) dirByRepo.set(k, e)
  }
  return (dirIndex = list)
}

const searchLocal = (entries: DirEntry[], terms: string[], installed: Set<string>, limit = 6): RecoItem[] => {
  const ts = terms.map(t => t.toLowerCase()).filter(Boolean)
  const scored: { e: DirEntry; s: number }[] = []
  for (const e of entries) {
    let s = 0
    for (const t of ts) {
      if (e.lname.includes(t)) s += 3
      if (e.lsum.includes(t)) s += 1
    }
    if (s > 0) scored.push({ e, s })
  }
  // 관련도가 우선이고, 확인된 출처일수록 가산점 (관련 없는 것이 관련 높은 것을 밀어내지 않을 만큼만)
  scored.sort(
    (a, b) =>
      b.s + tierBonus(b.e.tier) - (a.s + tierBonus(a.e.tier)) || b.s - a.s || tierRank(b.e.tier) - tierRank(a.e.tier),
  )
  return scored.slice(0, limit).map(({ e }) => ({
    id: `dir:${e.lname}`, name: clean(e.name, 80), summary: e.summary, repo: e.repo, owner: ownerOf(e.repo),
    tier: e.tier, flags: [], installed: installed.has(e.lname), cmd: e.cmd, source: 'dir' as const,
    rel: relevance(e.name, e.summary, ts),
  }))
}

// 찾은 결과를 추천 탭에 올린다 (검색어와 주제만 저장)
// 주제마다 따로 찾아서 묶음으로 올린다 (한 주제가 다른 주제를 밀어내지 않게)
const runGroups = async ($: any, specs: { cat: string; terms: string[] }[]): Promise<RecoGroup[]> => {
  const idx = await ensure($)
  const entries = await loadDir($)
  const installed = new Set(idx.items.map(i => i.name.toLowerCase()))
  const groups: RecoGroup[] = specs.map(s => ({
    cat: s.cat,
    terms: s.terms,
    local: searchLocal(entries, s.terms, installed, specs.length > 1 ? 4 : 6),
    github: [],
    ghStatus: 'idle',
    starsStatus: 'idle',
    showRest: false,
  }))
  for (const g of groups) for (const r of g.local) if (r.summary) recoTexts.add(r.summary)
  await update($, recoState, () => ({ groups, at: Date.now() }))
  void translateAll($, idx)
  return groups
}

const setGroup = ($: any, gi: number, patch: Partial<RecoGroup>) =>
  update($, recoState, s => ({ ...s, groups: s.groups.map((g, i) => (i === gi ? { ...g, ...patch } : g)) }))

// 한국어 검색어를 영어 키워드로 (사전에 없을 때만 모델을 쓴다)
const toEnglishTerms = async ($: any, q: string): Promise<string[]> => {
  const r = await $.model.complete({
    model: 'haiku',
    effort: 'low',
    maxTokens: 100,
    timeoutMs: 20000,
    prompt: `Give up to 3 short English search keywords (one per line, no numbering, no punctuation) for a plugin someone would look for when they say: "${q.slice(0, 80)}"`,
  })
  if (!r.isAnswered) return []
  return String(r.text)
    .split(/\r?\n/)
    .map((x: string) => x.trim().toLowerCase())
    .filter((x: string) => /^[a-z0-9 -]{2,30}$/.test(x))
    .slice(0, 3)
}

// GitHub 실시간 검색: 검색어만 보낸다. 로그인 정보나 대화 내용은 보내지 않는다.
const githubFind = async ($: any, gi: number) => {
  const st = await read($, recoState)
  const terms = st.groups[gi]?.terms ?? []
  const primary = (terms[0] ?? '').replace(/[^a-z0-9 .-]/gi, '').trim()
  if (!primary) return
  await setGroup($, gi, { ghStatus: 'searching', github: [] })
  try {
    // 주제(topic)를 OR로 묶으면 결과가 0건이라, 주제별로 따로 찾아 합친다
    const found = new Map<string, any>()
    let lastErr = ''
    for (const topic of ['claude-code-plugin', 'claude-skills', 'claude-code']) {
      const q = `${primary} topic:${topic} archived:false`
      // 검색어와 가장 잘 맞는 순(기본 정렬)으로 가져온다. 별 순으로 가져오면 검색어가 곁다리로만 나오는 인기 저장소가 섞인다.
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=10`
      const r = await $.http.fetch(url, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ai-tool-tracker' },
      })
      if (!r.ok) {
        lastErr = `HTTP ${r.status}${r.status === 403 || r.status === 429 ? ' (rate limit, try again in a minute)' : ''}`
        if (r.status === 403 || r.status === 429) break
        continue
      }
      for (const i of JSON.parse(r.text).items ?? []) if (!found.has(i.full_name)) found.set(i.full_name, i)
    }
    if (found.size === 0 && lastErr) throw new Error(lastErr)
    await loadDir($) // 디렉터리와 교차 확인하려면 저장소 표가 필요하다
    const idx = await ensure($)
    const installed = new Set(idx.items.map(i => i.name.toLowerCase()))
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
    const all: RecoItem[] = [...found.values()].flatMap((i: any) => {
      const repo = safeRepo(i.full_name) // 응답 값도 믿지 않고 다시 검증한다
      if (!repo) return []
      const known = dirByRepo.get(repo.toLowerCase()) // 디렉터리에도 있으면 그 등급을 따른다
      return [{
        id: `gh:${repo}`, name: repo, summary: clean(i.description, 300), repo, owner: ownerOf(repo),
        tier: known ? known.tier : ('github' as Tier), flags: githubFlags(i), installed: installed.has(String(i.name ?? '').toLowerCase()),
        stars: num(i.stargazers_count), forks: num(i.forks_count), pushed: clean(i.pushed_at, 10),
        lic: clean(i.license?.spdx_id, 30) || undefined,
        cmd: installCmd('', '', repo), source: 'github' as const,
        rel: relevance(
          String(i.name ?? ''),
          clean(i.description, 300),
          terms,
          Array.isArray(i.topics) ? i.topics.map((t: unknown) => String(t)) : [], // 저장소가 스스로 붙인 주제
        ),
      }]
    })
    // 이름이나 설명에 검색어가 있는 것만 남기고, 별이 많은 순으로 12개를 담는다.
    // 추천 1·2위를 뽑는 순서는 화면에서 디렉터리 결과와 합쳐서 정한다.
    const items = all.filter(x => x.rel >= 1).sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0)).slice(0, 12)
    for (const it of items) if (it.summary) recoTexts.add(it.summary)
    await setGroup($, gi, { github: items, ghStatus: items.length > 0 ? 'done' : 'empty' })
    void translateAll($, idx)
  } catch (err: any) {
    await setGroup($, gi, { ghStatus: `error:${String(err?.message ?? err).slice(0, 100)}` })
  }
}

const GH_HEADERS = { Accept: 'application/vnd.github+json', 'User-Agent': 'ai-tool-tracker' }

// 저장소 이름들로 별·갈라 쓴 수·갱신일·라이선스를 한 번에 가져온다 (검색 한 번에 최대 6개). 보내는 것은 공개 저장소의 이름(owner/repo)뿐이다.
const fetchRepoInfo = async ($: any, repos: string[]): Promise<Map<string, any>> => {
  const out = new Map<string, any>()
  const uniq = [...new Set(repos.map(r => safeRepo(r)).filter(Boolean).map(r => r.toLowerCase()))]
  let i = 0
  while (i < uniq.length) {
    const chunk: string[] = []
    let len = 0
    // 검색어는 256자까지라, 길이를 보며 최대 6개씩 묶는다
    while (i < uniq.length && chunk.length < 6 && len + uniq[i].length + 6 < 230) {
      chunk.push(uniq[i])
      len += uniq[i].length + 6
      i++
    }
    if (chunk.length === 0) {
      i++ // 너무 긴 이름은 건너뛴다
      continue
    }
    const q = chunk.map(r => `repo:${r}`).join(' ')
    const r = await $.http.fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=10`, {
      headers: GH_HEADERS,
    })
    if (!r.ok) {
      throw new Error(`HTTP ${r.status}${r.status === 403 || r.status === 429 ? ' (rate limit, try again in a minute)' : ''}`)
    }
    for (const it of JSON.parse(r.text).items ?? []) {
      const full = safeRepo(it.full_name)
      if (full) out.set(full.toLowerCase(), it)
    }
  }
  return out
}

// 추천 묶음의 디렉터리 결과에 별 개수 등을 채운다
const checkStars = async ($: any, gi: number) => {
  const st = await read($, recoState)
  const g = st.groups[gi]
  if (!g) return
  const repos = g.local.map(x => x.repo).filter(Boolean)
  if (repos.length === 0) {
    await setGroup($, gi, { starsStatus: 'done' })
    return
  }
  await setGroup($, gi, { starsStatus: 'checking' })
  try {
    const info = await fetchRepoInfo($, repos)
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
    const local = g.local.map(x => {
      const i = info.get(x.repo.toLowerCase())
      if (!i) return x
      return {
        ...x, stars: num(i.stargazers_count), forks: num(i.forks_count), pushed: clean(i.pushed_at, 10),
        lic: clean(i.license?.spdx_id, 30) || undefined, flags: githubFlags(i),
      }
    })
    await setGroup($, gi, { local, starsStatus: 'done' })
  } catch (err: any) {
    await setGroup($, gi, { starsStatus: `error:${String(err?.message ?? err).slice(0, 100)}` })
  }
}

// 별 개수를 먼저 확인한 다음 GitHub에서 더 찾는다 (검색 제한에 걸리면 거기서 멈춘다)
const starsThenSearch = async ($: any, gi: number) => {
  await checkStars($, gi)
  const st = await read($, recoState)
  if ((st.groups[gi]?.starsStatus ?? '').includes('rate limit')) return
  await githubFind($, gi)
}

// 사용자 범위 플러그인만 켜고 끌 수 있다. 이 패널을 만드는 플러그인 자신은 끌 수 없게 막고, 키 모양이 이상한 것은 건드리지 않는다.
const canToggleItem = (it: Item): boolean => {
  if (it.kind !== 'plugin' || !it.key || it.where || it.name === 'ai-tool-tracker') return false
  const [n, m, extra] = it.key.split('@')
  return !!safeName(n) && !!safeName(m) && extra === undefined
}

// 여러 플러그인을 차례로 켜거나 끈다 (전체 또는 한 묶음). 하나가 실패해도 나머지는 계속하고, 끝에 실패한 것을 알려 준다.
const doBulk = async ($: any, scope: string, enable: boolean, targets: Item[]) => {
  const id = `bulk:${scope}:${enable ? 'on' : 'off'}`
  const list = targets.filter(canToggleItem)
  let done = 0
  const failed: string[] = []
  try {
    for (let i = 0; i < list.length; i++) {
      await setMove($, id, `run:${i + 1}/${list.length}`)
      const r = await $.process.run(['claude', 'plugin', enable ? 'enable' : 'disable', list[i].key, '--scope', 'user'], {
        timeoutMs: 60000,
      })
      if (r.exitCode === 0) done++
      else failed.push(`${list[i].name}: ${String(r.stderr || r.stdout || 'failed').trim().slice(0, 60)}`)
    }
    await setMove($, id, failed.length > 0 ? `error:${failed.join(' | ').slice(0, 200)}` : `done:${done}`)
    await rescan($)
    await update($, uses, l => [...l])
  } catch (err: any) {
    await setMove($, id, `error:${String(err?.message ?? err).slice(0, 100)}`)
  }
}

// 프리셋을 적용한다: 먼저 끄고, 그다음 켠다. 하나가 실패해도 나머지는 계속하고 끝에 알려 준다.
const doPreset = async ($: any, id: string, plan: { off: Item[]; on: Item[] }) => {
  const list: [Item, boolean][] = [
    ...plan.off.filter(canToggleItem).map(it => [it, false] as [Item, boolean]),
    ...plan.on.filter(canToggleItem).map(it => [it, true] as [Item, boolean]),
  ]
  let done = 0
  const failed: string[] = []
  try {
    for (let i = 0; i < list.length; i++) {
      await setMove($, id, `run:${i + 1}/${list.length}`)
      const [it, enable] = list[i]
      const r = await $.process.run(['claude', 'plugin', enable ? 'enable' : 'disable', it.key, '--scope', 'user'], {
        timeoutMs: 60000,
      })
      if (r.exitCode === 0) done++
      else failed.push(`${it.name}: ${String(r.stderr || r.stdout || 'failed').trim().slice(0, 60)}`)
    }
    await setMove($, id, failed.length > 0 ? `error:${failed.join(' | ').slice(0, 200)}` : `done:${done}`)
    await rescan($)
    await update($, uses, l => [...l])
  } catch (err: any) {
    await setMove($, id, `error:${String(err?.message ?? err).slice(0, 100)}`)
  }
}

const prepare = async ($: any) => translateAll($, await ensure($))

const rescan = ($: any) => {
  index = undefined
  loading = undefined
  return ensure($)
}

// ---------------------------------------------------------------------------
// 3) 호출 하나를 어느 도구(그룹)로 볼지 정하기
// ---------------------------------------------------------------------------
const describe = (e: any): { name: string; detail: string } | undefined => {
  const t: string = e.tool
  if (t === 'Skill') return { name: `skill:${e.skill}`, detail: shorten(e.args ?? e.skill) }
  if (t === 'Agent') return { name: `Agent:${e.subagent_type ?? 'general'}`, detail: shorten(e.description ?? '') }
  if (t === 'Write' || t === 'Edit') return { name: t, detail: shorten(String(e.file_path ?? '').split(/[\\/]/).pop() ?? '') }
  if (t === 'Bash' || t === 'PowerShell') return { name: t, detail: shorten(e.description ?? e.command ?? '') }
  if (t === 'Artifact') return { name: t, detail: shorten(e.action ?? 'publish') }
  if (t === 'WebSearch' || t === 'WebFetch') return { name: t, detail: shorten(e.query ?? e.url ?? '') }
  if (t.startsWith('mcp__')) {
    const [, server, ...rest] = t.split('__')
    return { name: t, detail: `${server}: ${rest.join('__')}` }
  }
  return undefined // Read/Grep 같은 탐색 도구는 노이즈라 제외
}

// 호출한 도구가 어느 설치 항목(플러그인·스킬)의 것인지: 설치 색인에서 찾는다
const resolveOwner = (name: string, idx: Index): string | undefined => {
  let owner: string | undefined
  if (name.startsWith('skill:')) {
    owner = idx.skillOwner.get(name.slice(6))
  } else if (name.startsWith('Agent:')) {
    const prefix = name.slice(6).split(':')[0]
    owner = idx.items.find(i => i.name === prefix)?.name
  } else if (name.startsWith('mcp__')) {
    const server = name.split('__')[1] ?? ''
    owner = idx.items.find(i => i.mcp.includes(server))?.name
    if (!owner && server.startsWith('plugin_')) {
      const rest = server.slice(7)
      owner = idx.items.find(i => rest === i.name || rest.startsWith(`${i.name}_`))?.name
    }
  }
  return owner
}

// 사용 기록에 남길 이름: 색인에서 찾은 항목, 없으면 덮어쓰기 목록의 키와 이름이 같은 플러그인
const ownerItem = (name: string, detail: string, idx: Index): string | undefined => {
  const o = resolveOwner(name, idx)
  if (o) return o
  const cat = CATALOG.find(c => c.match.test(name)) ?? CATALOG.find(c => c.match.test(detail))
  return cat ? idx.items.find(i => i.name.toLowerCase() === cat.key)?.name : undefined
}

// 그룹 키: 덮어쓰기 목록 > 설치 색인(`p:<이름>`) > 기타
const classify = (name: string, detail: string, idx: Index): string => {
  const cat = CATALOG.find(c => c.match.test(name)) ?? CATALOG.find(c => c.match.test(detail))
  if (cat) return cat.key

  const owner = resolveOwner(name, idx)
  if (owner) return `p:${owner}`
  // 목록에 없는 MCP 도구는 도구마다 따로 보이지 않게 서버 이름으로 묶는다
  if (name.startsWith('mcp__')) return `mcp:${name.split('__')[1] ?? name}`
  return `other:${name}`
}

const fmt = (at: number) => {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// ---------------------------------------------------------------------------
// 3-1) 사용 기록: 어떤 플러그인이 언제 마지막으로 쓰였는지 (세션이 바뀌어도 남는다)
// ---------------------------------------------------------------------------
let hist: History = emptyHistory(Date.now())
let histWrote = 0
let unusedDays = DEFAULT_DAYS
let customs: Custom[] = [] // 내 프리셋 (이름과 켜 둘 플러그인 이름 목록)

const loadHistory = async ($: any) => {
  const now = Date.now()
  const raw = await safe($.store.get('use-history'))
  hist = parseHistory(raw, now)
  const d = await safe($.store.get('unused-days'))
  unusedDays = DAY_OPTIONS.includes(d as number) ? (d as number) : DEFAULT_DAYS
  customs = parseCustom(await safe($.store.get('presets-v2')))
  if (customs.length === 0) {
    // 예전 버전이 저장한 "내 프리셋"(이름 목록 하나)이 있으면 새 모양으로 옮긴다
    const old = await safe($.store.get('preset-mine'))
    const moved = migrateMine(old, ui().prMineTitle)
    if (moved.length > 0) {
      customs = moved
      await safe($.store.set('presets-v2', customs))
    }
  }
  if (raw === undefined || raw === null) await safe($.store.set('use-history', hist)) // 기록을 시작한 날을 남긴다
}

// 한 번 쓰인 것을 기록한다. 저장은 새 이름이 처음 나왔거나 마지막 저장 후 1분이 지났을 때만 한다
const noteUse = async ($: any, name: string) => {
  const now = Date.now()
  const isNew = !hist.items[name]
  hist = record(hist, name, now)
  if (isNew || now - histWrote > 60_000) {
    histWrote = now
    const stored = parseHistory(await safe($.store.get('use-history')), now) // 다른 세션이 저장한 것과 합친다
    hist = merge(hist, stored)
    await safe($.store.set('use-history', hist))
  }
}

/** 내 프리셋을 바꾸고 저장한 뒤 화면을 다시 그리게 한다 */
const saveCustoms = async ($: any, next: Custom[]) => {
  customs = next
  await safe($.store.set('presets-v2', customs))
  await setMove($, '__pm', String(Date.now()))
}

const setUnusedDays = async ($: any, n: number) => {
  unusedDays = n
  await safe($.store.set('unused-days', n))
  await setMove($, '__days', String(n)) // 화면을 다시 그리게 한다
}

// ---------------------------------------------------------------------------
// 3-2) 용도별 하위 에이전트 (분업)
// ---------------------------------------------------------------------------
let agentSet: AgentSettings = DEFAULT_SETTINGS // 훅이 읽는 현재 설정 (화면은 같은 값을 atom에서 읽는다)
const agentOf = new Map<string, CatKey>() // 하위 에이전트 id -> 묶음 (사용량을 묶음에 더하려고)
let spawnCount = 0 // 이번 요청(프롬프트)에서 시작한 하위 에이전트 수
// 플러그인별 "미리 차지하는 토큰" 측정값(근사치). 자주 읽지 않게 잠깐 보관한다
type CostMap = { at: number; plugins: Record<string, { skills: number; agents: number; mcp: number; total: number }>; skills: Record<string, number> }
let costCache: CostMap | undefined

/** 묶음에 든 플러그인·스킬. 이 플러그인 자신은 뺀다 */
const membersOf = (idx: Index, cat: CatKey) =>
  idx.items.filter(i => i.cat === cat && (i.kind === 'plugin' || i.kind === 'skill') && i.name !== PLUGIN_ID)

/** 켜져 있으면 묶음마다 에이전트 종류를 등록한다. 이름이 같으면 바뀐 설정으로 덮어쓴다 */
const syncAgents = async ($: any) => {
  if (!agentSet.on) return
  const idx = await ensure($)
  for (const cat of AGENT_CATS) {
    const members = membersOf(idx, cat)
    if (members.length === 0) continue
    const spec = buildSpec(cat, String(ui()[`catg_${cat}`] ?? cat), members, cfgOf(agentSet, cat))
    const reg = await safe($.agent.register(spec))
    if (!reg) $.ui.toast(ui().agRegFail(String(ui()[`catg_${cat}`] ?? cat)))
  }
}

const loadAgents = async ($: any) => {
  agentSet = parseSettings(await safe($.store.get('agent-settings')))
  await update($, agentCfgState, () => agentSet)
  await syncAgents($)
}

/** 설정을 바꾸고 저장한 뒤 에이전트를 다시 등록한다 */
const saveAgents = async ($: any, next: AgentSettings) => {
  agentSet = next
  await update($, agentCfgState, () => next)
  await safe($.store.set('agent-settings', next))
  await syncAgents($)
}

// ---------------------------------------------------------------------------
// 4) 훅
// ---------------------------------------------------------------------------
export const register: Register = (on, options) => {
  const picked = (options as any)?.language
  lang = typeof picked === 'string' && LANG_NAME[picked] ? picked : 'ko'
  const ms = parseInt(String((options as any)?.minStars ?? '10'), 10)
  minStars = [0, 10, 30, 100].includes(ms) ? ms : 10

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ai-tools',
      description: ui().cmdTools,
    })
    await $.command.register({
      name: 'ai-log',
      description: ui().cmdLog,
    })
    await $.command.register({ name: 'ai-find', description: ui().findUsage, argumentHint: '[feature]' })
    void prepare($) // 설치된 스킬·플러그인 읽고, 필요하면 번역
    void loadAgents($).catch(() => {}) // 분업 설정을 불러오고, 켜져 있으면 에이전트 종류를 등록
    void loadHistory($).catch(() => {}) // 사용 기록을 불러온다
    void $.ui.open({ id: PANE, title: ui().paneTitle })
    return next(e)
  })

  on('command.run', { command: 'ai-tools' }, async $ => {
    const idx = await rescan($)
    await $.ui.open({ id: PANE, title: ui().paneTitle })
    void translateAll($, idx)
    return { text: ui().opened(idx.items.length) }
  })

  // Claude Code 밖에서 쓴 도구는 자동으로 알 수 없으므로 직접 기록한다
  on('command.run', { command: 'ai-log' }, async ($, e) => {
    const text = e.args.trim()
    if (!text) return { text: ui().usage }
    const [tool, ...rest] = text.split(/\s+/)
    const use: Use = {
      id: `manual-${Date.now()}`,
      key: `ext:${tool.toLowerCase()}`,
      name: tool,
      detail: shorten(rest.join(' ') || ui().manualNote),
      isDone: true,
      at: Date.now(),
    }
    await update($, uses, list => [...list, use].slice(-300))
    return { text: ui().logged(tool) }
  })

  // /ai-find <찾고 싶은 기능>: 디렉터리와 GitHub를 함께 찾는다 (직접 입력한 검색어이므로 GitHub로 보낸다)
  on('command.run', { command: 'ai-find' }, async ($, e) => {
    const q = e.args.trim()
    if (!q) return { text: ui().findUsage }
    // 주제가 여러 개면(예: "동영상과 pdf") 주제마다 묶음을 만든다
    let specs = detectCats(q.toLowerCase()).map(c => ({ cat: c.key, terms: c.terms }))
    if (specs.length === 0) {
      let terms = /[^\x00-\x7f]/.test(q) ? await toEnglishTerms($, q) : []
      if (terms.length === 0) terms = q.split(/\s+/).filter(w => /^[a-z0-9.-]{2,}$/i.test(w)).slice(0, 3)
      if (terms.length > 0) specs = [{ cat: '', terms }]
    }
    if (specs.length === 0) return { text: ui().findUsage }
    const groups = await runGroups($, specs)
    await update($, tabState, () => 'reco')
    await $.ui.open({ id: PANE, title: ui().paneTitle })
    // 직접 입력한 검색어이므로 GitHub도 같이 찾는다 (묶음마다, 제한에 걸리면 멈춘다)
    void (async () => {
      for (let gi = 0; gi < groups.length; gi++) {
        await starsThenSearch($, gi)
        const s = await read($, recoState)
        const g = s.groups[gi]
        if (g?.ghStatus.includes('rate limit') || g?.starsStatus.includes('rate limit')) break
      }
    })()
    return { text: ui().findStarted(groups.map(g => g.terms[0]).join(', ')) }
  })

  // 요청에서 주제를 감지하면 이 PC의 디렉터리에서만 찾는다. 모델과 인터넷은 쓰지 않고, 원문은 저장하지 않는다.
  let lastCat = ''
  let lastAt = 0
  on('prompt.submit', async ($, e, next) => {
    spawnCount = 0 // 새 요청이 시작되면 하위 에이전트 수를 다시 센다
    try {
      const text = String(e.text ?? '').toLowerCase()
      const cats = text && !text.startsWith('/') ? detectCats(text) : []
      const sig = cats.map(c => c.key).join('+')
      if (cats.length > 0 && (sig !== lastCat || Date.now() - lastAt > 10 * 60 * 1000)) {
        lastCat = sig
        lastAt = Date.now()
        const groups = await runGroups($, cats.map(c => ({ cat: c.key, terms: c.terms })))
        const fresh = groups.reduce((n, g) => n + g.local.filter(r => !r.installed).length, 0)
        const names = cats.map(c => ui()[`cat_${c.key}`] ?? c.key).join(' · ')
        if (fresh > 0) $.ui.toast(ui().recoToast(fresh, names))
      }
    } catch {}
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const d = describe(e)
    if (!d) return next(e)
    const idx = await ensure($)
    const key = classify(d.name, d.detail, idx)
    const own = ownerItem(d.name, d.detail, idx)
    if (own) void noteUse($, own).catch(() => {})
    const use: Use = {
      id: e.tool_use_id,
      key,
      name: d.name,
      detail: d.detail,
      isDone: false,
      at: Date.now(),
    }
    await update($, uses, list => [...list, use].slice(-300))
    $.ui.status(ui().running(d.name))
    const ran = await next(e)
    await update($, uses, list =>
      list.map(u => (u.id === use.id ? { ...u, isDone: true } : u)),
    )
    $.ui.status(undefined)
    return ran
  }).catch(($, e, next) => next(e))

  // 분업: 우리 에이전트 종류만 다룬다. 설정이 꺼져 있으면 모델에게 보이지 않게 한다.
  on('agent.offer', async ($, e, next) => {
    if (catOfType(e.agent) === undefined) return next(e)
    return { isOffered: agentSet.on }
  }).catch(($, e, next) => next(e))

  // 새 하위 에이전트를 시작하기 전에 토큰 한도를 확인하고, 시작되면 어느 묶음의 것인지 기억한다
  on('agent.spawn', async ($, e, next) => {
    const cat = catOfType(e.subagentType)
    if (cat === undefined) return next(e)
    // 1) 사용량 보호: 5시간·7일 중 하나라도 기준을 넘었으면 새 하위 에이전트를 시작하지 않는다
    const lim = await safe($.session.usage())
    const hit = overGuard(lim?.rateLimits, agentSet.guard5, agentSet.guard7)
    if (hit) return { deny: ui().guardDeny(hit.kind === 'five_hour' ? ui().usFive : ui().usSeven, Math.round(hit.percent), hit.guard) }
    // 2) 한 요청에서 한꺼번에 너무 많이 띄우지 못하게 한다
    if (spawnCount >= MAX_SPAWNS_PER_PROMPT) return { deny: ui().spawnCap(MAX_SPAWNS_PER_PROMPT) }
    const cfg = cfgOf(agentSet, cat)
    const used = (await read($, agentUseState))[cat]?.tokens ?? 0
    if (isOver(used, cfg.budget)) {
      const label = String(ui()[`catg_${cat}`] ?? cat)
      return { deny: ui().agOver(label, fmtTokens(used), fmtTokens(cfg.budget)) }
    }
    const started = await next(e)
    if (started.agentId) {
      spawnCount++
      agentOf.set(started.agentId, cat)
      await update($, agentUseState, u => addUsage(u, cat, 0, 1))
    }
    return started
  }).catch(($, e, next) => next(e))

  // 하위 에이전트가 한 턴을 마칠 때마다 쓴 토큰을 그 묶음에 더한다
  // 또 메인 대화의 턴이 끝날 때, 5시간 사용량이 80%, 95%를 넘어서는 순간 한 번만 알린다
  let lastLevel: Level | undefined
  on('turn.complete', async ($, e, next) => {
    const cat = e.agentId ? agentOf.get(e.agentId) : undefined
    if (cat !== undefined && e.usage) await update($, agentUseState, u => addUsage(u, cat, tokensOf(e.usage!)))
    if (e.agentId === undefined) {
      const u: any = await safe($.session.usage())
      const w = pickWindow(u?.rateLimits, 'five_hour')
      if (w) {
        const lv = levelOf(w.percent)
        if (shouldWarn(lastLevel, lv)) $.ui.toast(ui().usToast(String(Math.round(w.percent))))
        lastLevel = lv
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text, Link, Input } = $.ui.resolve(e)
    const list = await read($, uses)
    const idx = await ensure($)
    const moveState = await read($, moves)
    const openState = await read($, open)
    // 저장된 값이 예전 모양이어도 화면이 깨지지 않게 한 번 더 확인한다
    const recoRaw = await read($, recoState)
    const reco: RecoState = { groups: Array.isArray(recoRaw?.groups) ? recoRaw.groups : [], at: recoRaw?.at ?? 0 }
    const tab = await read($, tabState)
    const sub = await read($, subState)
    const agCfg = parseSettings(await read($, agentCfgState))
    // 사용량: Claude Code가 알려 주는 값. 읽기만 하고 비용은 들지 않는다
    const usage: any = await safe($.session.usage())
    const five = pickWindow(usage?.rateLimits, 'five_hour')
    const seven = pickWindow(usage?.rateLimits, 'seven_day')
    const ctxPct = pct(usage?.context?.percent)
    const costUsd = typeof usage?.cost?.usd === 'number' ? usage.cost.usd : undefined
    // 플러그인별 "미리 차지하는 토큰": 1분에 한 번만 다시 잰다. 모델 호출 없이 Claude Code의 어림값을 읽는다
    if (!costCache || Date.now() - costCache.at > 60_000) {
      const bd: any = await safe($.session.usage({ breakdown: 'summary' }))
      const names = idx.items.filter(i => i.kind === 'plugin').map(i => i.name)
      const a = attribute(bd?.context?.breakdown, names)
      costCache = { at: Date.now(), plugins: a.plugins, skills: a.skills }
    }
    const costOf = (it: Item): number | undefined => {
      if (!it.enabled && it.kind === 'plugin') return undefined
      const c = it.kind === 'plugin' ? costCache?.plugins[it.name]?.total : costCache?.skills[it.name]
      return c && c > 0 ? c : undefined
    }
    const usageLine = (label: string, w: { percent: number; resetsAt?: string }) => {
      const lv = levelOf(w.percent)
      const left = untilReset(w.resetsAt, Date.now())
      return (
        <Box gap={1}>
          <Text dimColor>{label}</Text>
          <Text color={levelColor(lv)}>{bar(w.percent)}</Text>
          <Text bold>{Math.round(w.percent)}%</Text>
          {left && <Text dimColor>{left.h > 0 ? ui().usResetH(left.h, left.m) : ui().usResetM(left.m)}</Text>}
        </Box>
      )
    }
    const agUse = (await read($, agentUseState)) ?? {}
    const modelText = (m: string) => (m === 'inherit' ? ui().agInherit : modelLabel(m))
    const budgetText = (n: number) => (n === 0 ? ui().agNoLimit : fmtTokens(n))
    const rows = e.viewport?.rows ?? 40

    // 도구별 집계 (최근 사용 순)
    const groups = new Map<string, Use[]>()
    for (const u of list) groups.set(u.key, [...(groups.get(u.key) ?? []), u])
    const ordered = [...groups.entries()].sort(
      (a, b) => b[1][b[1].length - 1].at - a[1][a[1].length - 1].at,
    )

    const labelOf = (key: string, sample: Use): { label: string; role: string } => {
      const c = CATALOG.find(x => x.key === key)
      if (c) return { label: catLabel(c), role: roleOf(c) }
      if (key.startsWith('mcp:')) return { label: key.slice(4), role: ui().mcpGeneric }
      if (key.startsWith('p:')) {
        const it = idx.items.find(i => i.name === key.slice(2))
        if (it) {
          const extra = it.kind === 'plugin' && it.skills.length > 0 ? ui().skills(it.skills.length) : ''
          return { label: it.name, role: (it.summary ? tx(it.summary) : ui().noDesc) + extra }
        }
      }
      if (key.startsWith('ext:')) return { label: sample.name, role: ui().ext }
      return { label: sample.name, role: ui().unknown }
    }

    const usedNames = new Set(
      ordered.filter(([k]) => k.startsWith('p:')).map(([k]) => k.slice(2)),
    )

    // 탭마다 따로 쓰므로 자기 탭의 화면 높이만 생각하면 된다
    const timeline = list.slice(-Math.max(8, rows - 8 - ordered.length * 2))
    const budget = Math.max(8, rows - 14) // 구역 제목·안내 줄만큼 여유
    const installed = [...idx.items].sort(
      (a, b) =>
        Number(usedNames.has(b.name)) - Number(usedNames.has(a.name)) ||
        a.name.localeCompare(b.name),
    )

    // 번역 진행 상황: [끝난 개수, 전체 개수]
    const uiKeys = Object.keys(uiTemplates())
    const uiStat: [number, number] =
      lang === 'ko' || lang === 'en'
        ? [uiKeys.length, uiKeys.length] // 직접 적은 문구라 처음부터 모두 있다
        : [uiKeys.filter(k => uiTr[lang]?.[k]).length, uiKeys.length]
    const descTexts = new Set<string>()
    for (const it of idx.items) {
      if (it.summary) descTexts.add(it.summary)
      for (const c of it.children) if (c.summary) descTexts.add(c.summary)
    }
    const descNeed = [...descTexts].filter(t => srcOf(t) !== lang)
    const descStat: [number, number] = [descNeed.filter(t => tmaps[lang]?.[t]).length, descNeed.length]

    // 추천 한 건 그리기 (디렉터리와 GitHub 결과가 같이 쓴다)
    const tierColor = (t: string) =>
      t === 'official' || t === 'anthropic' || t === 'partner' ? 'success' : t === 'github' ? 'error' : 'warning'
    const recoRow = (r: RecoItem, rank?: number) => {
      const link = githubLink(r.repo) // 주소는 검증한 owner/repo로 직접 만든 것만 쓴다
      const facts = [
        `${ui().ownerLabel}: ${r.owner || '—'}`,
        r.stars !== undefined ? `★${r.stars}` : '',
        r.forks !== undefined ? `⑂${r.forks}` : '',
        r.pushed || '',
        r.lic && r.lic !== 'NOASSERTION' ? r.lic : '',
      ].filter(Boolean).join(' · ')
      return (
        <Box flexDirection="column">
          <Box>
            {rank ? <Text color="success" bold>{ui().recoPick(rank)} </Text> : null}
            <Text bold>{r.name}</Text>
            <Text color={tierColor(r.tier)}> [{ui()[`tier_${r.tier}`] ?? r.tier}]</Text>
            {r.installed && <Text dimColor> [{ui().recoInstalled}]</Text>}
          </Box>
          <Text dimColor>{facts}</Text>
          {isLowStars(r, minStars) && <Text color="error">⚠ {ui().fewStars(r.stars ?? 0, minStars)}</Text>}
          {r.stars === undefined && <Text dimColor>{ui().starsUnknown}</Text>}
          {(r.flags ?? []).map(fl => (
            <Text color="warning">⚠ {ui()[`flag_${fl}`] ?? fl}</Text>
          ))}
          <Text dimColor>{r.summary ? tx(r.summary) : ui().noDesc}</Text>
          {r.tier === 'github' && <Text color="warning">⚠ {ui().recoWarn}</Text>}
          <Box>
            {link ? <Link href={link} label={ui().recoOpen} /> : null}
            {r.cmd ? (
              <Button
                key={`copy-${r.id}`}
                label={ui().recoCopy}
                onPress={press => {
                  void $.ui.copy({ text: r.cmd, surface: press.surface })
                  $.ui.toast(ui().recoCopied)
                }}
              />
            ) : null}
          </Box>
          {r.cmd ? <Text dimColor>  {r.cmd}</Text> : <Text dimColor>  {ui().noCmd}</Text>}
          <Text> </Text>
        </Box>
      )
    }

    // 추천 한 묶음: 별이 가장 많은 1~2개를 맨 위에 "추천"으로 보여주고, 나머지는 눌러야 보인다
    const recoGroup = (g: RecoGroup, gi: number) => {
      const merged = mergeRecos(g.local, g.github) as RecoItem[]
      const rk = rankRecos(merged, minStars, 2)
      const busy = g.starsStatus === 'checking' || g.ghStatus === 'searching'
      const preview = rk.starsKnown ? [] : rk.rest.slice(0, 4) // 별을 모르면 출처·관련도 순으로 일부만
      const t0 = g.terms[0] ?? ''
      const canCheck = g.starsStatus !== 'done' && g.local.some(x => x.repo)
      const canSearch = g.ghStatus === 'idle' || g.ghStatus.startsWith('error:')
      return (
        <Box flexDirection="column">
          <Text> </Text>
          <Text bold>
            {g.cat
              ? ui().recoTopic(ui()[`cat_${g.cat}`] ?? g.cat, g.terms.join(', '))
              : ui().recoTopicFree(g.terms.join(', '))}
          </Text>
          {merged.length === 0 && <Text dimColor>{ui().recoLocalNone}</Text>}
          {!rk.starsKnown && merged.length > 0 && <Text color="warning">{ui().recoStarsUnknown}</Text>}
          {rk.starsKnown && rk.top.length === 0 && merged.length > 0 && (
            <Text color="warning">{ui().recoNoTop(minStars)}</Text>
          )}
          {rk.top.length > 0 && <Text bold>{ui().recoTop(rk.top.length)}</Text>}
          {rk.top.map((r, i) => recoRow(r, i + 1))}
          {preview.map(r => recoRow(r))}
          {rk.starsKnown && rk.rest.length > 0 && (
            <Button
              key={`rest-${gi}`}
              label={g.showRest ? ui().recoRestHide : ui().recoRestShow(rk.rest.length)}
              onPress={() => void setGroup($, gi, { showRest: !g.showRest })}
            />
          )}
          {rk.starsKnown && g.showRest && rk.rest.map(r => recoRow(r))}
          <Text dimColor>{ui().recoGithubTitle}</Text>
          {!busy && (canCheck || canSearch) && (
            <Box flexDirection="column">
              <Box>
                {canCheck && (
                  <Button key={`stars-${gi}`} label={ui().recoStarsBtn} onPress={() => void checkStars($, gi)} />
                )}
                {canSearch && (
                  <Button
                    key={`gh-go-${gi}`}
                    label={ui().recoGithubBtn(t0)}
                    onPress={() => void starsThenSearch($, gi)}
                  />
                )}
              </Box>
              <Text dimColor>{ui().recoSending(t0)}</Text>
            </Box>
          )}
          {g.starsStatus === 'checking' && <Text dimColor>{ui().recoStarsChecking}</Text>}
          {g.ghStatus === 'searching' && <Text dimColor>{ui().recoSearching}</Text>}
          {g.starsStatus.startsWith('error:') && <Text>⚠ {ui().recoGhErr(g.starsStatus.slice(6))}</Text>}
          {g.ghStatus.startsWith('error:') && <Text>⚠ {ui().recoGhErr(g.ghStatus.slice(6))}</Text>}
          {g.ghStatus === 'empty' && <Text dimColor>{ui().recoGhNone}</Text>}
        </Box>
      )
    }

    // 켜기/끄기 버튼 (전체 또는 한 묶음). 진행 중이거나 확인 중이면 버튼을 숨긴다.
    const bulkBusy = (scope: string) => {
      const a = moveState[`bulk:${scope}:off`] ?? ''
      const b = moveState[`bulk:${scope}:on`] ?? ''
      return (a !== '' && a !== 'idle') || (b !== '' && b !== 'idle')
    }
    const bulkButtons = (scope: string, list: Item[]) => {
      if (bulkBusy(scope)) return null
      const isAll = scope === 'all'
      const offT = list.filter(it => canToggleItem(it) && it.enabled)
      const onT = list.filter(it => canToggleItem(it) && !it.enabled)
      return (
        <Box gap={1}>
          {onT.length > 0 && (
            <Button
              key={`bulk-on-${scope}`}
              label={isAll ? ui().allOn : ui().groupOn}
              onPress={() => setMove($, `bulk:${scope}:on`, 'confirm')}
            />
          )}
          {offT.length > 0 && (
            <Button
              key={`bulk-off-${scope}`}
              label={isAll ? ui().allOff : ui().groupOff}
              onPress={() => setMove($, `bulk:${scope}:off`, 'confirm')}
            />
          )}
        </Box>
      )
    }
    // 확인·진행·결과 줄
    const bulkStatus = (scope: string, list: Item[]) => {
      const out: any[] = []
      for (const dir of ['off', 'on'] as const) {
        const id = `bulk:${scope}:${dir}`
        const st = moveState[id] ?? ''
        if (st === '' || st === 'idle') continue
        const enable = dir === 'on'
        const targets = list.filter(it => canToggleItem(it) && it.enabled !== enable)
        if (st === 'confirm') {
          out.push(
            <Box flexDirection="column">
              <Text>{enable ? ui().bulkAskOn(targets.length) : ui().bulkAskOff(targets.length)}</Text>
              <Box>
                <Button key={`${id}-yes`} label={ui().yes} onPress={() => void doBulk($, scope, enable, targets)} />
                <Button key={`${id}-no`} label={ui().cancel} onPress={() => setMove($, id, 'idle')} />
              </Box>
            </Box>,
          )
        } else if (st.startsWith('run:')) {
          const [i, n] = st.slice(4).split('/')
          out.push(<Text dimColor>{ui().bulkRun(Number(i), Number(n))}</Text>)
        } else if (st.startsWith('done:')) {
          out.push(
            <Box flexDirection="column">
              <Text dimColor>{ui().bulkDone(Number(st.slice(5)))}</Text>
              <Button key={`${id}-ok`} label={ui().cacheOk} onPress={() => setMove($, id, 'idle')} />
            </Box>,
          )
        } else if (st.startsWith('error:')) {
          out.push(
            <Box flexDirection="column">
              <Text>⚠ {st.slice(6)}</Text>
              <Button key={`${id}-retry`} label={ui().retry} onPress={() => setMove($, id, 'idle')} />
            </Box>,
          )
        }
      }
      return out.length > 0 ? <Box flexDirection="column">{out}</Box> : null
    }
    // 묶음 머리글: 누르면 접고 펼치고, 플러그인이면 그 묶음만 켜고 끌 수 있다
    const headerRow = (cat: CatKey, items: Item[]) => {
      const collapsed = !!openState[`cat:${cat}`]
      return (
        <Box flexDirection="column" marginTop={1}>
          <Box gap={2}>
            <Button
              key={`cat-${cat}`}
              label={`${collapsed ? '▸' : '▾'} ${ui()[`catg_${cat}`] ?? cat} (${items.length})`}
              onPress={() => update($, open, m => ({ ...m, [`cat:${cat}`]: !m[`cat:${cat}`] }))}
            />
            {sub !== 'skills' && bulkButtons(`cat:${cat}`, items)}
          </Box>
          {sub !== 'skills' && bulkStatus(`cat:${cat}`, items)}
          {agCfg.on && (AGENT_CATS as string[]).includes(cat) && (
            <Text dimColor>
              {ui().agLine(
                modelText(cfgOf(agCfg, cat).model),
                budgetText(cfgOf(agCfg, cat).budget),
                fmtTokens(agUse[cat]?.tokens ?? 0),
              )}
            </Text>
          )}
        </Box>
      )
    }

    // 플러그인/스킬 구역에서 같이 쓰는 한 항목 그리기
    const renderRow = (it: Item) => {
          const isOpen = !!openState[it.name]
          // 사용자 범위 플러그인만 켜고 끌 수 있다. 이 패널을 만드는 모드 자신은 끌 수 없게 막는다.
          const canToggle = canToggleItem(it)
          const toggleState = moveState[`toggle:${it.key}`] ?? ''
          const mark = usedNames.has(it.name) ? '●' : '○'
          const kindText = it.kind === 'plugin' ? ui().plugin : ui().skill
          const whereText = it.where ? ui().scopeFolder(it.where) : ui().scopeAll
          const countText = it.children.length > 0 ? ` · ${ui().skills(it.children.length).trim()}` : ''
          // 펼치면 보이는 것: 스킬, 서브에이전트, MCP 서버
          // 호출 명령어: 플러그인 스킬은 /플러그인:스킬, 내 스킬은 /스킬
          const prefix = it.kind === 'plugin' ? `${it.name}:` : ''
          const skillRows =
            it.kind === 'plugin' || it.children.length > 0 ? it.children : [{ name: it.name, summary: it.summary }]
          const details: string[] = [
            ...skillRows.map(c => `/${prefix}${c.name} — ${c.summary ? tx(c.summary) : ui().noDesc}`),
            ...it.agents.map(x => `${ui().agentTag}: ${x}`),
            ...it.mcp.map(x => `MCP: ${x}`),
          ]
          return (
            <Box marginTop={1} paddingLeft={1}>
              {it.kind === 'plugin' && (
              <Box width={16} flexShrink={0}>
                {canToggle && (
                  <Box>
                    <Text backgroundColor={it.enabled ? 'success' : 'error'} color="inverseText" bold>
                      {` ${it.enabled ? ui().on : ui().off} `}
                    </Text>
                    <Text> </Text>
                    <Button
                      key={`toggle-${it.key}`}
                      label={it.enabled ? ui().turnOff : ui().turnOn}
                      onPress={() => void doToggle($, it)}
                    />
                  </Box>
                )}
              </Box>
              )}
              <Box flexDirection="column">
                <Box>
                  <Button
                    key={`open-${it.name}`}
                    label={`${isOpen ? '▾' : '▸'} ${mark} ${it.name}`}
                    onPress={() => update($, open, m => ({ ...m, [it.name]: !m[it.name] }))}
                  />
                  <Text dimColor> [{kindText} · {whereText}{countText}]</Text>
                </Box>
                <Text dimColor>{it.summary ? tx(it.summary) : ui().noDesc}</Text>
                {it.kind === 'plugin' && !it.enabled && canToggle && <Text dimColor>{ui().tokOffNote}</Text>}
                {costOf(it) !== undefined && <Text dimColor>{ui().tokAlways(fmtTokens(costOf(it) ?? 0))}</Text>}
                {canToggle && toggleState === 'changed' && (
                  <Text dimColor>{it.enabled ? ui().nowOn : ui().nowOff}</Text>
                )}
                {toggleState.startsWith('error:') && <Text>⚠ {toggleState.slice(6)}</Text>}
                {isOpen &&
                  (details.length === 0 ? (
                    <Text dimColor>· {ui().noParts}</Text>
                  ) : (
                    details.map(d => <Text dimColor>· {d}</Text>)
                  ))}
              </Box>
            </Box>
          )
    }
    // 작업 모드 탭: 목적에 맞는 플러그인만 켜고 나머지는 끈다. 기본 모드는 고정이고, 내 프리셋은 만들고 고치고 지울 수 있다.
    const modeTab = () => {
      const pool = installed.filter(i => i.kind === 'plugin')
      const planItems: PlanItem[] = pool.map(i => ({ name: i.name, cat: i.cat, enabled: i.enabled, toggleable: canToggleItem(i) }))
      const byName = new Map(pool.map(i => [i.name, i] as const))
      const toItems = (names: string[]) => names.map(n => byName.get(n)).filter((x): x is Item => !!x)
      type Row = { id: string; label: string; plan: Plan; custom?: Custom }
      const builtin: Row[] = PRESETS.map(pr => ({
        id: pr.key,
        label: String(ui()[`pr_${pr.key}`] ?? pr.key),
        plan: planByCats(planItems, pr.cats),
      }))
      const mineRows: Row[] = customs.map(c => ({ id: c.id, label: c.name, plan: planByNames(planItems, c.names), custom: c }))
      const mv = (k: string) => moveState[k] ?? 'idle'

      // 적용 확인·진행·결과 줄
      const applyStatus = (x: Row) => {
        const mid = `preset:${x.id}`
        const st = mv(mid)
        const offItems = toItems(x.plan.off)
        const onItems = toItems(x.plan.on)
        if (st === 'confirm') {
          const saved = offItems.reduce((n, i) => n + (costOf(i) ?? 0), 0)
          return (
            <Box flexDirection="column" paddingLeft={2}>
              <Text>{saved > 0 ? ui().prAskSave(x.label, onItems.length, offItems.length, fmtTokens(saved)) : ui().prAsk(x.label, onItems.length, offItems.length)}</Text>
              <Box gap={1}>
                <Button key={`${mid}-yes`} label={ui().yes} onPress={() => void doPreset($, mid, { off: offItems, on: onItems })} />
                <Button key={`${mid}-no`} label={ui().cancel} onPress={() => setMove($, mid, 'idle')} />
              </Box>
            </Box>
          )
        }
        if (st.startsWith('run:')) {
          const [i, n] = st.slice(4).split('/')
          return <Text dimColor>  {ui().prRun(Number(i), Number(n))}</Text>
        }
        if (st.startsWith('done:')) {
          return (
            <Box flexDirection="column" paddingLeft={2}>
              <Text dimColor>{ui().prDone(Number(st.slice(5)))}</Text>
              <Button key={`${mid}-ok`} label={ui().cacheOk} onPress={() => setMove($, mid, 'idle')} />
            </Box>
          )
        }
        if (st.startsWith('error:')) {
          return (
            <Box flexDirection="column" paddingLeft={2}>
              <Text>⚠ {st.slice(6)}</Text>
              <Button key={`${mid}-retry`} label={ui().retry} onPress={() => setMove($, mid, 'idle')} />
            </Box>
          )
        }
        return null
      }

      // 편집: 플러그인마다 눌러서 넣고 빼기 (묶음별로)
      const editor = (c: Custom) => {
        const groups = CATEGORY_ORDER.map(cat => ({ cat, list: pool.filter(i => i.cat === cat && canToggleItem(i)) })).filter(g => g.list.length > 0)
        return (
          <Box flexDirection="column" paddingLeft={2}>
            <Text dimColor>{ui().prEditHint}</Text>
            {groups.map(g => (
              <Box flexDirection="column" marginTop={1}>
                <Text bold>{ui()[`catg_${g.cat}`] ?? g.cat}</Text>
                <Box gap={1} paddingLeft={1}>
                  {g.list.map(i => (
                    <Button
                      key={`pe-${c.id}-${i.name}`}
                      label={`${c.names.includes(i.name) ? '✓' : '○'} ${i.name}`}
                      variant={c.names.includes(i.name) ? 'primary' : undefined}
                      onPress={() => void saveCustoms($, toggleMember(customs, c.id, i.name))}
                    />
                  ))}
                </Box>
              </Box>
            ))}
            <Box gap={1} marginTop={1}>
              <Button
                key={`pe-now-${c.id}`}
                label={ui().prOverwrite}
                onPress={() => void saveCustoms($, replaceMembers(customs, c.id, enabledNames(planItems)))}
              />
              <Button key={`pe-done-${c.id}`} label={ui().prEditDone} onPress={() => setMove($, 'pm:edit', 'idle')} />
            </Box>
          </Box>
        )
      }

      const row = (x: Row) => {
        const c = x.custom
        const editing = !!c && mv('pm:edit') === c.id
        const renaming = !!c && mv('pm:ren') === c.id
        const deleting = !!c && mv(`pm:del:${c.id}`) === 'confirm'
        const applying = mv(`preset:${x.id}`) !== 'idle'
        const nothing = isEmptyPlan(x.plan)
        return (
          <Box flexDirection="column" marginTop={1}>
            <Box gap={1}>
              <Text bold>{x.label}</Text>
              {c && <Text dimColor>({ui().prCount(c.names.length)})</Text>}
              {nothing && <Text dimColor>· {ui().prSame}</Text>}
            </Box>
            {!applying && !editing && !renaming && !deleting && (
              <Box gap={1} paddingLeft={2}>
                <Button
                  key={`pa-${x.id}`}
                  label={ui().prApply}
                  onPress={() => (nothing ? $.ui.toast(ui().prNothing) : void setMove($, `preset:${x.id}`, 'confirm'))}
                />
                {c ? (
                  <Box gap={1}>
                    <Button key={`pe-${x.id}`} label={ui().prEdit} onPress={() => setMove($, 'pm:edit', c.id)} />
                    <Button key={`pr-${x.id}`} label={ui().prRename} onPress={() => setMove($, 'pm:ren', c.id)} />
                    <Button key={`pd-${x.id}`} label={ui().prDelete} onPress={() => setMove($, `pm:del:${c.id}`, 'confirm')} />
                  </Box>
                ) : (
                  <Button
                    key={`pc-${x.id}`}
                    label={ui().prCopy}
                    onPress={() => {
                      const cats = PRESETS.find(pr => pr.key === x.id)?.cats ?? []
                      const names = planItems.filter(i => i.toggleable && cats.includes(i.cat)).map(i => i.name)
                      const next = addCustom(customs, newId(customs, Date.now()), x.label, names)
                      if (next === customs) $.ui.toast(ui().prFull(MAX_CUSTOM))
                      else void saveCustoms($, next)
                    }}
                  />
                )}
              </Box>
            )}
            {applyStatus(x)}
            {renaming && c && (
              <Box paddingLeft={2}>
                <Input
                  key={`prn-${c.id}`}
                  label={`${ui().prNameLabel} `}
                  value={c.name}
                  onSubmit={(v: string) => {
                    if (cleanLabel(v) === '') $.ui.toast(ui().agBad)
                    else void saveCustoms($, renameCustom(customs, c.id, v))
                    void setMove($, 'pm:ren', 'idle')
                  }}
                />
              </Box>
            )}
            {deleting && c && (
              <Box flexDirection="column" paddingLeft={2}>
                <Text>{ui().prDelAsk(c.name)}</Text>
                <Box gap={1}>
                  <Button
                    key={`pdy-${c.id}`}
                    label={ui().yes}
                    onPress={() => {
                      void setMove($, `pm:del:${c.id}`, 'idle')
                      void saveCustoms($, deleteCustom(customs, c.id))
                    }}
                  />
                  <Button key={`pdn-${c.id}`} label={ui().cancel} onPress={() => setMove($, `pm:del:${c.id}`, 'idle')} />
                </Box>
              </Box>
            )}
            {editing && c && editor(c)}
          </Box>
        )
      }

      return (
        <Box flexDirection="column">
          <Text bold>{ui().prTitle}</Text>
          <Text dimColor>{ui().prHint}</Text>
          <Text bold> </Text>
          <Text bold>{ui().prBuiltin}</Text>
          {builtin.map(row)}
          <Text> </Text>
          <Text bold>{ui().prMineTitle}</Text>
          {mineRows.length === 0 && <Text dimColor>{ui().prEmpty}</Text>}
          {mineRows.map(row)}
          <Box marginTop={1}>
            {customs.length < MAX_CUSTOM ? (
              <Input
                key="pnew"
                label={`${ui().prNewLabel} `}
                placeholder={ui().prNewHint}
                onSubmit={(v: string) => {
                  const next = addCustom(customs, newId(customs, Date.now()), v, enabledNames(planItems))
                  if (next === customs) $.ui.toast(ui().agBad)
                  else void saveCustoms($, next)
                }}
              />
            ) : (
              <Text dimColor>{ui().prFull(MAX_CUSTOM)}</Text>
            )}
          </Box>
          <Text dimColor>{ui().prNote}</Text>
        </Box>
      )
    }
    // 안 쓴 플러그인: 켜 둔 것 중 정한 기간 동안 한 번도 안 쓰인 것. 상시 토큰과 함께 보여주고 바로 끌 수 있다
    const unusedSection = () => {
      const pool = installed.filter(i => i.kind === 'plugin' && i.enabled && canToggleItem(i))
      const un = unusedList(hist, pool.map(i => i.name), Date.now(), unusedDays)
      const byName = new Map(pool.map(i => [i.name, i] as const))
      const items = un.list.map(u => byName.get(u.name)).filter((x): x is Item => !!x)
      const saved = items.reduce((n, i) => n + (costOf(i) ?? 0), 0)
      return (
        <Box flexDirection="column" marginTop={1}>
          <Box gap={1}>
            <Text bold>{ui().unTitle}</Text>
            <Button
              key="un-days"
              label={ui().unDays(unusedDays)}
              onPress={() => void setUnusedDays($, cycle(DAY_OPTIONS, unusedDays))}
            />
          </Box>
          {!un.ready && <Text dimColor>{ui().unLearning(un.trackedDays, unusedDays)}</Text>}
          {un.ready && un.list.length === 0 && <Text dimColor>{ui().unNone(unusedDays)}</Text>}
          {un.ready &&
            un.list.slice(0, 8).map(u => {
              const it = byName.get(u.name)
              const c = it ? costOf(it) : undefined
              return (
                <Box gap={1} paddingLeft={1}>
                  <Text>{u.name}</Text>
                  <Text dimColor>
                    {u.lastDays === undefined ? ui().unNever : ui().unAgo(u.lastDays)}
                    {c ? ` · ${ui().tokAlways(fmtTokens(c))}` : ''}
                  </Text>
                  {it && <Button key={`un-off-${u.name}`} label={ui().turnOff} onPress={() => void doToggle($, it)} />}
                </Box>
              )
            })}
          {un.ready && un.list.length > 8 && <Text dimColor>  …+{un.list.length - 8}</Text>}
          {un.ready && items.length > 0 && !bulkBusy('unused') && (
            <Button
              key="un-off-all"
              label={saved > 0 ? ui().unOffAllSave(items.length, fmtTokens(saved)) : ui().unOffAll(items.length)}
              onPress={() => setMove($, 'bulk:unused:off', 'confirm')}
            />
          )}
          {un.ready && bulkStatus('unused', items)}
          <Text dimColor>{ui().unNote}</Text>
        </Box>
      )
    }
    const plugCount = installed.filter(i => i.kind === 'plugin').length
    const skillCount = installed.filter(i => i.kind === 'skill').length

    // 지금 보고 있는 구역의 항목을 용도별로 묶는다. 접은 묶음은 항목을 숨기고, 나머지는 화면 높이 안에서 자른다.
    const visible = installed.filter(i => i.kind === (sub === 'skills' ? 'skill' : 'plugin'))
    type Entry = { type: 'header'; cat: CatKey; items: Item[] } | { type: 'item'; it: Item }
    const grouped = new Map<CatKey, Item[]>()
    for (const it of visible) grouped.set(it.cat, [...(grouped.get(it.cat) ?? []), it])
    const entries: Entry[] = []
    for (const cat of CATEGORY_ORDER) {
      const list = grouped.get(cat)
      if (!list) continue
      entries.push({ type: 'header', cat, items: list })
      if (!openState[`cat:${cat}`]) for (const it of list) entries.push({ type: 'item', it })
    }
    let usedLines = 0
    const shownEntries: Entry[] = []
    const showAll = !!openState['__all'] // "더 보기"를 누르면 화면 높이와 상관없이 전부
    for (const en of entries) {
      const need =
        en.type === 'header'
          ? 2
          : 3 + (openState[en.it.name] ? Math.max(1, en.it.children.length + en.it.agents.length + en.it.mcp.length) : 0)
      if (!showAll && shownEntries.length > 0 && usedLines + need > budget) break
      usedLines += need
      shownEntries.push(en)
    }
    const hiddenCount =
      entries.filter(e => e.type === 'item').length - shownEntries.filter(e => e.type === 'item').length

    return (
      <Box flexDirection="column">
        <Box gap={1}>
          {([
            ['tools', ui().tabTools],
            ['log', ui().tabLog(list.length)],
            ['reco', ui().tabReco(reco.groups.reduce((n, g) => n + g.local.length + g.github.length, 0))],
            ['mode', ui().tabMode],
            ['env', ui().tabEnv],
          ] as const).map(([id, label]) => (
            <Button
              key={`tab-${id}`}
              label={label}
              variant={tab === id ? 'primary' : undefined}
              onPress={() => update($, tabState, () => id)}
            />
          ))}
        </Box>
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{ui().usTitle}</Text>
          {!five && !seven && <Text dimColor>{ui().usNone}</Text>}
          {five && usageLine(ui().usFive, five)}
          {seven && usageLine(ui().usSeven, seven)}
          {(ctxPct !== undefined || costUsd !== undefined) && (
            <Text dimColor>
              {ctxPct !== undefined ? `${ui().usCtx} ${Math.round(ctxPct)}%` : ''}
              {ctxPct !== undefined && costUsd !== undefined ? ' · ' : ''}
              {costUsd !== undefined ? `${ui().usCost} $${costUsd.toFixed(2)}` : ''}
            </Text>
          )}
          {five && levelOf(five.percent) !== 'ok' && (
            <Text color={levelColor(levelOf(five.percent))}>
              {levelOf(five.percent) === 'mid' ? ui().usAdvMid : levelOf(five.percent) === 'high' ? ui().usAdvHigh : ui().usAdvFull}
            </Text>
          )}
          <Text dimColor>{ui().usNote}</Text>
        </Box>
        <Text> </Text>
        {tab === 'log' && (
          <Box flexDirection="column">
        <Text bold>{ui().used}</Text>
        {ordered.length === 0 && <Text dimColor>{ui().none}</Text>}
        {ordered.map(([key, items]) => {
          const { label, role } = labelOf(key, items[0])
          const running = items.some(u => !u.isDone)
          return (
            <Box flexDirection="column">
              <Text bold>
                {running ? '▶ ' : '✓ '}
                {label} <Text dimColor>×{items.length}</Text>
              </Text>
              <Text dimColor>   {role}</Text>
            </Box>
          )
        })}
        <Text> </Text>
        <Text bold>{ui().timeline}</Text>
        {timeline.map(u => (
          <Text dimColor={u.isDone}>
            {fmt(u.at)} {u.isDone ? '✓' : '▶'} {u.name} — {u.detail}
          </Text>
        ))}
        <Text> </Text>
          </Box>
        )}
        {tab === 'tools' && (
          <Box flexDirection="column">
        <Text> </Text>
        <Box gap={1}>
          <Button
            key="sub-plugins"
            label={ui().subPlugins(plugCount)}
            variant={sub === 'skills' ? undefined : 'primary'}
            onPress={() => update($, subState, () => 'plugins')}
          />
          <Button
            key="sub-skills"
            label={ui().subSkills(skillCount)}
            variant={sub === 'skills' ? 'primary' : undefined}
            onPress={() => update($, subState, () => 'skills')}
          />
        </Box>
        <Text> </Text>
        {idx.items.length === 0 && <Text dimColor>{ui().noInst}</Text>}
        {idx.items.length > 0 && visible.length === 0 && <Text dimColor>{ui().noneHere}</Text>}
        {visible.length > 0 && (
          <Box flexDirection="column">
            <Text bold>{sub === 'skills' ? ui().secSkills(skillCount) : ui().secPlugins(plugCount)}</Text>
            <Text dimColor>{sub === 'skills' ? ui().hintSkills : ui().hintPlugins}</Text>
            {sub !== 'skills' && (() => {
              const enabledNow = visible.filter(i => i.enabled)
              const sum = enabledNow.reduce((n, i) => n + (costOf(i) ?? 0), 0)
              return sum > 0 ? <Text bold>{ui().tokTotal(fmtTokens(sum), enabledNow.length)}</Text> : null
            })()}
            {sub !== 'skills' && <Text dimColor>{ui().tokNote}</Text>}
            {sub !== 'skills' && bulkButtons('all', visible)}
            {sub !== 'skills' && bulkStatus('all', visible)}
            <Text> </Text>
            {sub !== 'skills' && unusedSection()}
            {shownEntries.map(en => (en.type === 'header' ? headerRow(en.cat, en.items) : renderRow(en.it)))}
          </Box>
        )}
        {hiddenCount > 0 && (
          <Button
            key="show-all"
            label={ui().showMore(hiddenCount)}
            onPress={() => update($, open, m => ({ ...m, __all: true }))}
          />
        )}
        {showAll && (
          <Button
            key="show-less"
            label={ui().showLess}
            onPress={() => update($, open, m => ({ ...m, __all: false }))}
          />
        )}
        <Text> </Text>
          </Box>
        )}
        {tab === 'mode' && modeTab()}
        {tab === 'reco' && (
          <Box flexDirection="column">
            <Text bold>{ui().recoTitle}</Text>
            <Text dimColor>{ui().trustNote}</Text>
            {reco.groups.length === 0 && <Text dimColor>{ui().recoNone}</Text>}
            {reco.groups.map(recoGroup)}
          </Box>
        )}
        {tab === 'env' && (
          <Box flexDirection="column">
        <Box>
          <Text dimColor>{ui().langLabel}: </Text>
          {Object.keys(LANG_LABEL).map(code => (
            <Button
              key={`lang-${code}`}
              label={code === lang ? `● ${LANG_LABEL[code]}` : LANG_LABEL[code]}
              variant={code === lang ? 'primary' : undefined}
              onPress={() => void $.config.set({ key: 'ai-tool-tracker.language', value: code })}
            />
          ))}
        </Box>
        <Text> </Text>
        <Box>
          <Text dimColor>{ui().minStarsLabel}: </Text>
          {[0, 10, 30, 100].map(n => (
            <Button
              key={`ms-${n}`}
              label={n === minStars ? `● ${n}` : String(n)}
              variant={n === minStars ? 'primary' : undefined}
              onPress={() => void $.config.set({ key: 'ai-tool-tracker.minStars', value: String(n) })}
            />
          ))}
        </Box>
        <Text dimColor>{ui().minStarsHint}</Text>
        <Text> </Text>
        <Text bold>{ui().agTitle}</Text>
        <Text dimColor>{ui().agHint}</Text>
        <Box gap={1} marginTop={1}>
          <Text backgroundColor={agCfg.on ? 'success' : 'error'} color="inverseText" bold>
            {` ${agCfg.on ? ui().on : ui().off} `}
          </Text>
          <Button
            key="ag-master"
            label={agCfg.on ? ui().turnOff : ui().turnOn}
            onPress={() => void saveAgents($, { ...agCfg, on: !agCfg.on })}
          />
        </Box>
        {agCfg.on && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>{ui().agGuard}</Text>
            <Box gap={1} paddingLeft={2}>
              <Text dimColor>{ui().usFive}:</Text>
              <Button
                key="ag-guard5"
                label={agCfg.guard5 === 0 ? ui().agGuardOff : `${agCfg.guard5}%`}
                onPress={() => void saveAgents($, { ...agCfg, guard5: nextGuard(agCfg.guard5, agCfg.guard7) })}
              />
            </Box>
            <Box gap={1} paddingLeft={2}>
              <Text dimColor>{ui().usSeven}:</Text>
              <Button
                key="ag-guard7"
                label={agCfg.guard7 === 0 ? ui().agGuardOff : `${agCfg.guard7}%`}
                onPress={() => void saveAgents($, { ...agCfg, guard7: nextGuard(agCfg.guard7, agCfg.guard5) })}
              />
            </Box>
            <Text dimColor>{ui().agGuardHint}</Text>
          </Box>
        )}
        {agCfg.on && AGENT_CATS.filter(c => membersOf(idx, c).length > 0).length === 0 && (
          <Text dimColor>{ui().agNone}</Text>
        )}
        {agCfg.on &&
          AGENT_CATS.filter(c => membersOf(idx, c).length > 0).map(cat => {
            const cfg = cfgOf(agCfg, cat)
            const lim = limitsOf(cfg.model)
            const store = (next: typeof cfg) =>
              void saveAgents($, { ...agCfg, cats: { ...agCfg.cats, [cat]: next } })
            const put = (patch: Partial<typeof cfg>) => store({ ...cfg, ...patch })
            const setModel = (m: string) => store(changeModel(cfg, m))
            const putNum = (key: 'budget' | 'maxTurns', n: number, r: { min: number; max: number }) => {
              const f = fit(n, r as any)
              put({ [key]: f.value })
              if (f.adjusted) $.ui.toast(ui().agAdjusted(fmtTokens(r.min), fmtTokens(r.max), fmtTokens(f.value)))
            }
            return (
              <Box flexDirection="column" marginTop={1}>
                <Text bold>
                  {ui()[`catg_${cat}`] ?? cat} <Text dimColor>({membersOf(idx, cat).length})</Text>
                </Text>
                <Box gap={1} paddingLeft={2}>
                  <Text dimColor>{ui().agModel}:</Text>
                  <Button
                    key={`ag-model-${cat}`}
                    label={modelText(cfg.model)}
                    onPress={() => setModel(cycle(MODEL_PRESETS, cfg.model))}
                  />
                </Box>
                <Box paddingLeft={2}>
                  <Input
                    key={`ag-model-in-${cat}`}
                    label={`${ui().agModelCustom} `}
                    placeholder="claude-opus-5-5"
                    value={MODEL_PRESETS.includes(cfg.model) ? '' : cfg.model}
                    onSubmit={(v: string) => {
                      const m = parseModel(v)
                      if (m) setModel(m)
                      else if (v.trim() === '') setModel('inherit')
                      else $.ui.toast(ui().agBad)
                    }}
                  />
                </Box>
                <Box paddingLeft={2}>
                  <Input
                    key={`ag-budget-in-${cat}`}
                    label={`${ui().agBudget} `}
                    placeholder={ui().agRange(fmtTokens(lim.budget.min), fmtTokens(lim.budget.max))}
                    value={String(cfg.budget)}
                    onSubmit={(v: string) => {
                      const n = parseTokens(v)
                      if (n === undefined) $.ui.toast(ui().agBad)
                      else putNum('budget', n, lim.budget)
                    }}
                  />
                </Box>
                <Box paddingLeft={2}>
                  <Input
                    key={`ag-turns-in-${cat}`}
                    label={`${ui().agTurns} `}
                    placeholder={ui().agRange(String(lim.turns.min), String(lim.turns.max))}
                    value={String(cfg.maxTurns)}
                    onSubmit={(v: string) => {
                      const n = parseTurns(v)
                      if (n === undefined) $.ui.toast(ui().agBad)
                      else putNum('maxTurns', n, lim.turns)
                    }}
                  />
                </Box>
                <Text dimColor>  {ui().agUsed(agUse[cat]?.runs ?? 0, fmtTokens(agUse[cat]?.tokens ?? 0))}</Text>
              </Box>
            )
          })}
        {agCfg.on && <Text dimColor>{ui().agLimitNote}</Text>}
        <Text> </Text>
        <Text bold>{ui().env}</Text>
        <Text dimColor>
          {ui().envRoot}: {diag.root || '?'} ({diag.fromEnv ? 'CLAUDE_CONFIG_DIR' : 'USERPROFILE/HOME'})
        </Text>
        <Text dimColor>{ui().envCount(diag.plugins, diag.skills, diag.mcp)}</Text>
        <Text dimColor>
          claude CLI: {diag.cli === undefined ? '?' : diag.cli ? ui().cliOk : ui().cliNo}
        </Text>
        {diag.plugins + diag.skills === 0 && <Text>⚠ {ui().envNone}</Text>}
        {diag.unread.length > 0 && <Text dimColor>{ui().unreadHead}:</Text>}
        {diag.unread.slice(0, 5).map(u => (
          <Text dimColor>  ⚠ {u.k === 'path' ? ui().unreadPath(u.name, u.path ?? '') : ui().unreadEmpty(u.name)}</Text>
        ))}
        <Text dimColor>{ui().transStatus(uiStat[0], uiStat[1], descStat[0], descStat[1])}</Text>
        <Text> </Text>
        <Text bold>{ui().cacheTitle(diag.oldCache.length)}</Text>
        {(moveState['__cache'] ?? 'idle') === 'idle' && diag.oldCache.length === 0 && (
          <Text dimColor>{ui().cacheNone}</Text>
        )}
        {(moveState['__cache'] ?? 'idle') === 'idle' &&
          diag.oldCache.slice(0, 8).map(c => (
            <Text dimColor>  · {c.label}</Text>
          ))}
        {(moveState['__cache'] ?? 'idle') === 'idle' && diag.oldCache.length > 8 && (
          <Text dimColor>  …+{diag.oldCache.length - 8}</Text>
        )}
        {diag.cacheSkipped > 0 && <Text dimColor>  {ui().cacheSkipped(diag.cacheSkipped)}</Text>}
        {(moveState['__cache'] ?? 'idle') === 'idle' && diag.oldCache.length > 0 && (
          <Button key="cache-go" label={ui().cacheBtn} onPress={() => setMove($, '__cache', 'confirmCopy')} />
        )}
        {moveState['__cache'] === 'confirmCopy' && (
          <Box flexDirection="column">
            <Text>  {ui().cacheAsk(diag.oldCache.length)}</Text>
            <Box>
              <Button key="cache-yes" label={ui().yes} onPress={() => void cleanCache($)} />
              <Button key="cache-no" label={ui().cancel} onPress={() => setMove($, '__cache', 'idle')} />
            </Box>
          </Box>
        )}
        {(moveState['__cache'] ?? '').startsWith('cacheDone:') && (
          <Box flexDirection="column">
            <Text dimColor>  {ui().cacheDone(Number((moveState['__cache'] ?? '').slice(10)))}</Text>
            <Button key="cache-ok" label={ui().cacheOk} onPress={() => setMove($, '__cache', 'idle')} />
          </Box>
        )}
        {(moveState['__cache'] ?? '').startsWith('error:') && (
          <Box flexDirection="column">
            <Text>  ⚠ {(moveState['__cache'] ?? '').slice(6)}</Text>
            <Button key="cache-retry" label={ui().retry} onPress={() => setMove($, '__cache', 'idle')} />
          </Box>
        )}
        <Text> </Text>
        <Text bold>{ui().folderOnly}</Text>
        {idx.folderItems.length === 0 && (
          <Text dimColor>{ui().noFolder(checkedCount)}</Text>
        )}
        {idx.folderItems.map(f => {
          const st = moveState[f.id] ?? 'idle'
          return (
            <Box flexDirection="column">
              <Text>
                {f.kind === 'plugin' ? ui().plugin : f.kind === 'mod' ? ui().modLabel : ui().skill} {f.name}{' '}
                <Text dimColor>— {f.folder}</Text>
              </Text>
              {f.isGlobalAlready && st === 'idle' && (
                <Text dimColor>   {ui().alreadyGlobal}</Text>
              )}
              {(!f.isGlobalAlready || f.kind === 'mod') && st === 'idle' && (
                <Button
                  key={`${f.id}-go`}
                  label={f.isGlobalAlready ? ui().updateGlobal : ui().toGlobal}
                  onPress={() => setMove($, f.id, 'confirmCopy')}
                />
              )}
              {st === 'confirmCopy' && (
                <Box flexDirection="column">
                  <Text>   {f.kind === 'mod' ? ui().askMod : ui().askCopy}</Text>
                  <Box>
                    <Button key={`${f.id}-yes`} label={ui().yes} onPress={() => void doCopy($, f)} />
                    <Button key={`${f.id}-no`} label={ui().cancel} onPress={() => setMove($, f.id, 'idle')} />
                  </Box>
                </Box>
              )}
              {st === 'copied' && (
                <Box flexDirection="column">
                  <Text dimColor>   {ui().copied}</Text>
                  {f.canRemove ? (
                    <Button key={`${f.id}-rm`} label={ui().removeOrig} onPress={() => setMove($, f.id, 'confirmRemove')} />
                  ) : (
                    <Box flexDirection="column">
                      <Text dimColor>   {f.kind === 'mod' ? ui().modKeep : ui().manualOff}</Text>
                      {f.kind === 'mod' && (
                        <Button
                          key={`${f.id}-again`}
                          label={ui().updateGlobal}
                          onPress={() => setMove($, f.id, 'confirmCopy')}
                        />
                      )}
                    </Box>
                  )}
                </Box>
              )}
              {st === 'confirmRemove' && (
                <Box flexDirection="column">
                  <Text>   {ui().askRemove}</Text>
                  <Box>
                    <Button key={`${f.id}-yes2`} label={ui().yes} onPress={() => void doRemove($, f)} />
                    <Button key={`${f.id}-no2`} label={ui().cancel} onPress={() => setMove($, f.id, 'copied')} />
                  </Box>
                </Box>
              )}
              {st === 'removed' && <Text dimColor>   {ui().removed}</Text>}
              {st.startsWith('error:') && (
                <Box flexDirection="column">
                  <Text>   ⚠ {st.slice(6)}</Text>
                  <Button key={`${f.id}-retry`} label={ui().retry} onPress={() => setMove($, f.id, 'idle')} />
                </Box>
              )}
            </Box>
          )
        })}
          </Box>
        )}
      </Box>
    )
  }).catch(($, e) => {
    // 그리는 중 오류가 나도 빈 화면 대신 안내가 보이게 한다
    const { Text } = $.ui.resolve(e)
    return <Text>⚠ {ui().renderErr}</Text>
  })
}
