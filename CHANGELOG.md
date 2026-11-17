# Changelog / 변경 기록

English first, Korean below each section. 영어가 먼저, 각 항목 아래에 한국어가 있습니다.

## Bugs found and how they were fixed / 찾은 오류와 고친 방법

These came from real use of the panel, from the tests, or from reading my own code again.
실제로 패널을 쓰면서, 시험에서, 또는 제 코드를 다시 읽으면서 찾은 것들입니다.

| What went wrong / 문제 | Why / 원인 | Fix / 고친 방법 |
| --- | --- | --- |
| The panel said "Nothing to show yet" after an update. / 업데이트 뒤 패널이 "보여줄 것이 없음"만 보여줌 | The saved state had an older shape than the new code expected. / 저장된 값의 모양이 새 코드가 기대하는 것과 달랐음 | Every stored value now has a `shape` tag that is bumped when its shape changes, values are normalized when read, and a drawing error shows a message instead of an empty panel. / 저장값마다 모양 표시(`shape`)를 두고 모양이 바뀌면 올림, 읽을 때 바로잡음, 그리는 중 오류는 빈 화면 대신 안내를 보여줌 |
| Japanese text appeared in the Korean screen, and Korean in other languages. / 한국어 화면에 일본어가, 다른 언어 화면에 한국어가 섞임 | One shared translation map was read after an `await` while the language was being switched. / 언어를 바꾸는 사이 하나를 같이 쓰는 번역 저장소를 `await` 뒤에 읽음 | One map per language, the language fixed at the start of a job, a check that the text is in the right script, and old mixed entries are purged on load. / 언어마다 저장소를 따로 두고, 작업 시작 때 언어를 고정, 글자 종류 검사, 이전에 섞인 항목은 불러올 때 삭제 |
| 66 plugin names with shell characters and raw homepage links could end up in commands and links. / 셸 특수문자가 든 플러그인 이름 66개와 홈페이지 링크가 명령·링크에 그대로 들어갈 수 있었음 | Names and addresses are written by other people and were trusted. / 이름과 주소는 남이 쓴 글인데 그대로 믿었음 | `hooks/trust.ts`: only allowed characters pass into a command, links are rebuilt from a verified `owner/repo`, invisible and direction-flipping characters are removed. / 허용한 글자만 명령에 들어가고, 링크는 검증한 `owner/repo`로 다시 만들고, 보이지 않는 글자와 방향을 뒤집는 글자를 지움 |
| `claude plugin update` did nothing. / `claude plugin update`가 아무것도 안 함 | The copy had the same version number. / 복사본의 버전 번호가 같았음 | The version is bumped with every change. / 바꿀 때마다 버전을 올림 |
| GitHub search "failed" for some topics. / 어떤 주제는 GitHub 검색이 "실패"함 | The error 403 was the limit of 10 searches per minute, not a bad query. / 403은 잘못된 검색어가 아니라 분당 10번 제한이었음 | The limit is recognized and explained, and a topic uses at most 4 searches. / 제한을 알아보고 안내하며, 주제마다 최대 4번만 씀 |
| Sorting only by stars recommended unrelated repositories. / 별 개수로만 정렬하자 관련 없는 저장소가 추천됨 | A repository with many stars that only mentions "PDF" once outranked real PDF tools. / "PDF"를 한 번 언급할 뿐인 별 많은 저장소가 진짜 PDF 도구를 앞섬 | Relevance first (name or topics 3, start of description 2, later 1), then stars; low-star unreviewed repositories are never picked. / 관련도가 먼저(이름·주제 3, 설명 앞부분 2, 뒤쪽 1), 그다음 별. 별이 적은 미검토 저장소는 추천하지 않음 |
| Some plugins were put in the wrong group (for example `box` under Dev). / 일부 플러그인이 엉뚱한 묶음에 들어감(예: `box`가 개발) | The words inside skill descriptions outweighed the plugin's own name. / 스킬 설명 속 단어가 플러그인 이름보다 크게 반영됨 | The name counts most, hits from skills are capped, agent names are included. / 이름을 가장 크게, 스킬에서 온 점수는 상한, 에이전트 이름도 반영 |
| A test found that `remotion` was given the tools of `remotion-pro`. / 시험이 `remotion`이 `remotion-pro`의 도구를 가져가는 것을 찾아냄 | Plugin names were matched as prefixes. / 플러그인 이름을 앞부분만 맞춰 비교함 | The separator (`:` or `_`) must match too. / 구분 글자(`:` 또는 `_`)까지 맞춰야 함 |
| A sub-agent budget could be used up in one go. / 하위 에이전트 토큰 한도가 한 번에 바닥날 수 있었음 | A sub-agent uses about 60k tokens just to start; several could be started at once; cache reads were not counted. / 하위 에이전트는 시작만 해도 약 6만 토큰이 듦, 여러 개를 한꺼번에 띄울 수 있었음, 캐시 읽기를 세지 않았음 | Per-model minimum budgets (at least 100k), at most 4 sub-agents per request, cache reads counted at 10%, and a usage protection that stops new sub-agents at a threshold you choose. / 모델별 최소 한도(10만 이상), 요청당 최대 4개, 캐시 읽기를 10%로 계산, 정한 기준 이상이면 새 하위 에이전트를 막는 사용량 보호 |
| In the other languages the reset time showed only minutes, the savings text showed an empty number, and the 80% warning showed "NaN%". / 다른 언어 화면에서 초기화까지 시간이 분만 보이고, 절약 문구에 빈 숫자가, 80% 경고에 "NaN%"가 나옴 | Translation turns each English sentence into a template by calling it with placeholders, so a sentence that changes with its numbers (`h > 0 ? ... : ...`, `Math.round(x)`) turned into the wrong template. / 번역은 영어 문구를 자리표시로 불러 틀을 만드는데, 숫자에 따라 모양이 바뀌거나 숫자를 가공하는 문구는 틀이 틀리게 만들어짐 | The sentences were split in two or the number is prepared by the caller, and a test now reads the sentence table and rejects such sentences. / 문구를 둘로 나누거나 숫자를 호출하는 쪽에서 가공하게 하고, 시험이 문구 표를 읽어 이런 문구를 막음 |
| `/ai-find` found nothing for Japanese or Chinese words. / `/ai-find`가 일본어·중국어 검색어로는 아무것도 못 찾음 | Only Korean words were turned into English search words. / 한국어만 영어 검색어로 바꿨음 | Any word not written in English is now converted. / 영어로 쓰지 않은 검색어는 모두 바꿈 |
| A typo in a custom model ID failed silently when registering a sub-agent. / 하위 에이전트의 모델 ID를 잘못 써도 아무 말 없이 등록에 실패함 | The failure was swallowed. / 실패를 삼켰음 | A message now says which group could not be registered. / 어느 묶음이 등록되지 않았는지 알려 줌 |
| The mod failed validation: two `turn.complete` hooks, a variable named `on`, an `import` in the types file. / 검증 실패: `turn.complete` 훅 두 개, `on`이라는 변수, 타입 파일 속 `import` | The API allows one hook per event without a matcher, reserves `on`, and wants the contract file self-contained. / 매처 없는 훅은 이벤트당 하나, `on`은 예약어, 타입 파일은 스스로 완결되어야 함 | Hooks merged, variable renamed, types written out in the file. / 훅을 합치고, 변수 이름을 바꾸고, 타입을 파일 안에 적음 |

## Improvements / 개선한 것

- **Tools grouped by purpose** (video, captions, images, planning, web, dev, data, security, files, marketing), collapsible. / **용도별 묶음**과 접기
- **Turn all on / off**, and per group, with a confirmation. / **전체·묶음별 켜기/끄기**(확인 후)
- **Recommendations by stars**: the 1 to 2 most-starred candidates that are named or tagged for the topic; a minimum-stars setting. / **별 많은 순 추천**과 최소 별 개수 설정
- **Division of work**: a sub-agent per group with its own model, token budget and max turns, with per-model defaults, minimums and maximums. / **분업**: 묶음마다 하위 에이전트, 모델·토큰 한도·최대 턴, 모델별 기본·최소·최대
- **Usage**: 5-hour and 7-day bars with the time to reset, advice, and a warning that appears once. Usage protection with separate 5-hour and weekly thresholds in steps of 10%. / **사용량** 막대, 안내, 한 번만 뜨는 경고, 5시간·주간 따로 10% 단위 보호
- **Estimated "always loaded" tokens per plugin**, so you can see what switching one off saves. / 플러그인마다 **상시 토큰 어림값**
- Roomier spacing in the panel. / 패널 간격을 넉넉하게
- **Unused plugins**: a usage history kept across sessions (name, last use, count) and a list of plugins unused for 7, 14 or 30 days with their always-loaded tokens. / **안 쓴 플러그인** 목록과 세션 사이에 남는 사용 기록
- **Work modes tab**: built-in modes and personal presets you can create, edit, rename and delete. / **작업 모드** 탭: 기본 모드와 만들고 고치고 지울 수 있는 내 프리셋
- 84 tests, covering safety, ranking, categories, sub-agents, usage, history, work modes and the sentence tables. / 시험 84개(문구 표 점검 포함)

## Known limits / 알려진 한계

- Tested on Windows in the desktop app only; the Mac and Linux branches are untested. / 윈도우 데스크톱 앱에서만 시험했고 맥·리눅스는 시험하지 못함
- The exact token count of the 5-hour limit is not published, so only percentages are shown. / 5시간 한도의 정확한 토큰 수는 공개되지 않아 퍼센트만 보여줌
- A sub-agent that is already running cannot be cut off; keep the budget and max turns low. / 이미 도는 하위 에이전트는 중간에 끊을 수 없으므로 한도와 최대 턴을 낮게 둘 것
- Stars measure popularity, not quality. / 별은 인기이지 품질이 아님
