export type Use = {
  id: string
  /** 카탈로그 키 (예: remotion, figma) */
  key: string
  /** 호출된 실제 이름 */
  name: string
  /** 무엇을 했는지 한 줄 */
  detail: string
  isDone: boolean
  at: number
}

/** 추천 한 건 (디렉터리 또는 GitHub 검색 결과). 남이 쓴 글은 정리한 뒤에만 담는다 */
export type RecoItem = {
  id: string
  name: string
  summary: string
  /** 검증한 owner/repo (없으면 빈 문자열). 링크는 이것으로 github.com 주소를 직접 만든다 */
  repo: string
  owner: string
  /** official | anthropic | partner | added | listed | github */
  tier: string
  /** stale | fresh | noLicense | fork | ratio */
  flags: string[]
  /** 이미 이 PC에 설치된 것 */
  installed: boolean
  stars?: number
  /** 갈라 쓴(fork) 수 */
  forks?: number
  /** 검색어와 얼마나 맞는지 (이름에 든 단어 3점, 설명에 든 단어 1점). GitHub에서 온 것은 0 */
  rel: number
  pushed?: string
  lic?: string
  /** 설치(또는 마켓플레이스 추가) 명령. 이름이 안전하지 않으면 빈 문자열 */
  cmd: string
  source: 'dir' | 'github'
}

/** 주제 하나의 추천 묶음 ("동영상과 pdf"면 두 묶음) */
export type RecoGroup = {
  /** 감지한 주제 키 (직접 검색이면 빈 문자열) */
  cat: string
  terms: string[]
  local: RecoItem[]
  github: RecoItem[]
  /** idle | searching | done | empty | error:<이유> */
  ghStatus: string
  /** 별 개수 확인 상태: idle | checking | done | error:<이유> */
  starsStatus: string
  /** 추천 1·2위 말고 나머지도 펼쳐 보는지 */
  showRest: boolean
}

export type RecoState = {
  groups: RecoGroup[]
  at: number
}

/** 용도별 하위 에이전트 한 묶음의 설정 (hooks/agents.ts의 AgentCfg와 같은 모양) */
export type AgentCfg = { model: string; budget: number; maxTurns: number }
/** 하위 에이전트 설정 전체: 켜짐 여부와 묶음별 설정 */
export type AgentSettings = { on: boolean; guard5: number; guard7: number; cats: Record<string, AgentCfg> }
/** 묶음별로 쓴 실행 횟수와 토큰 */
export type AgentUse = Record<string, { runs: number; tokens: number }>

declare module 'claude-code' {
  interface PluginState {
    'ai-tool-tracker': {
      uses: Shaped<Use[]>
      /** 폴더 전용 도구 id -> 진행 상태 (confirmCopy|copied|confirmRemove|removed|error:...) */
      moves: Shaped<Record<string, string>>
      /** 도구 탭 안에서 보고 있는 구역: plugins | skills */
      sub: Shaped<string>
      /** 보고 있는 탭: tools | log | reco | env */
      tab: Shaped<string>
      /** 펼쳐 둔 목록 항목 이름 -> true */
      open: Shaped<Record<string, boolean>>
      /** 추천 탭에 보여줄 결과 */
      reco: Shaped<RecoState>
      /** 용도별 하위 에이전트 설정 */
      agents: Shaped<AgentSettings>
      /** 이 세션에서 묶음별로 쓴 토큰과 실행 횟수 */
      agentUse: Shaped<AgentUse>
    }
  }
}
