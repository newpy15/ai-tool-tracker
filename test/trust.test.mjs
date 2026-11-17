// 실행: node --test test/
// 추천 링크·명령이 안전한지 확인하는 시험. Claude Code 없이 단독으로 돈다. (Node 23.6 이상)
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clean, safeName, safeRepo, repoFromUrl, githubLink, ownerOf,
  tierFromReview, tierRank, githubFlags, rankRecos, isLowStars, mergeRecos, relevance, termHit, safeRelPath,
} from '../hooks/trust.ts'

test('safeName: 명령에 쓸 수 있는 이름만 통과', () => {
  assert.equal(safeName('remotion'), 'remotion')
  assert.equal(safeName('claude-plugins-official'), 'claude-plugins-official')
  assert.equal(safeName('my_plugin.v2'), 'my_plugin.v2')
  // 실제 디렉터리에 있던 모양과 공격 모양: 모두 거절
  for (const bad of [
    'S&P Global', 'AI Video Editor & Timeline', 'Small Business', 'x; rm -rf ~', 'a|b', '$(calc)', '`id`',
    'a&&b', '--help', '-x', '.hidden', 'a b', 'a\nb', 'a"b', "a'b", 'a>out', '', '../x', 'a'.repeat(65),
  ]) assert.equal(safeName(bad), '', JSON.stringify(bad))
  assert.equal(safeName(undefined), '')
  assert.equal(safeName({ toString: () => 'x' }), '') // 문자열이 아닌 값은 거절
})

test('safeRepo: owner/repo 모양만 통과', () => {
  assert.equal(safeRepo('remotion-dev/remotion'), 'remotion-dev/remotion')
  assert.equal(safeRepo('a/b.git'), 'a/b')
  for (const bad of [
    '../x', 'a/b c', '-x/y', 'a/b;c', 'a/b&c', '$(x)/y', 'a', 'a/b/c', '/a/b', 'a/', '--upload-pack=x/y', 'a/..', 'a/b..c',
  ]) assert.equal(safeRepo(bad), '', JSON.stringify(bad))
})

test('repoFromUrl: github.com 주소만, 호스트 속임수는 거절', () => {
  assert.equal(repoFromUrl('https://github.com/remotion-dev/remotion'), 'remotion-dev/remotion')
  assert.equal(repoFromUrl('https://github.com/a/b.git'), 'a/b')
  assert.equal(repoFromUrl('https://github.com/a/b/tree/main/x'), 'a/b')
  assert.equal(repoFromUrl('HTTPS://GITHUB.COM/a/b'), 'a/b')
  for (const bad of [
    'https://github.com.evil.com/a/b',
    'https://evil.com/github.com/a/b',
    'https://github.com@evil.com/a/b',
    'https://evil.com/?u=https://github.com/a/b',
    'http://github.com/a/b',
    'javascript:alert(1)',
    'data:text/html,<script>1</script>',
    'file:///etc/passwd',
    'https://github.com/a',
    'https://gist.github.com/a/b',
    'https://raw.githubusercontent.com/a/b/x',
    '', null, undefined,
  ]) assert.equal(repoFromUrl(bad), '', String(bad))
})

test('githubLink: 검증한 값으로만 주소를 만든다', () => {
  assert.equal(githubLink('a/b'), 'https://github.com/a/b')
  assert.equal(githubLink('a/b;c'), '')
  assert.equal(githubLink('https://evil.com/x'), '')
  assert.equal(ownerOf('remotion-dev/remotion'), 'remotion-dev')
  assert.equal(ownerOf('bad value'), '')
})

test('clean: 눈속임 글자를 없앤다', () => {
  assert.equal(clean('a\nb\r\nc'), 'a b c')
  assert.equal(clean('‮gnp.exe'), 'gnp.exe') // 글자 방향 뒤집기
  assert.equal(clean('a​b⁦c⁩d'), 'a b c d') // 보이지 않는 글자
  assert.equal(clean('\u001b[31mred\u001b[0m'), '[31mred [0m') // 터미널 제어 문자
  assert.equal(clean('x'.repeat(300), 10), 'xxxxxxxxxx…')
  assert.equal(clean(null), '')
})

test('tierFromReview: 누가 검토했는지 모르면 높게 치지 않는다', () => {
  assert.equal(tierFromReview('done', 'anthropic'), 'anthropic')
  assert.equal(tierFromReview('done', 'partner'), 'partner')
  assert.equal(tierFromReview('done', 'someone'), 'listed')
  assert.equal(tierFromReview('none', 'anthropic'), 'listed')
  assert.equal(tierFromReview(undefined, undefined), 'listed')
  assert.ok(tierRank('anthropic') > tierRank('partner'))
  assert.ok(tierRank('partner') > tierRank('listed'))
  assert.ok(tierRank('listed') > tierRank('github'))
})

const R = (o) => ({ id: o.repo ?? o.name, name: o.name ?? 'x', summary: '', repo: '', owner: '', tier: 'listed', flags: [], installed: false, cmd: '', source: 'dir', rel: 3, ...o })

test('rankRecos: 별이 가장 많은 1~2개를 추천으로 뽑는다', () => {
  const items = [
    R({ name: 'zero', repo: 'a/zero', stars: 0 }),
    R({ name: 'big', repo: 'a/big', stars: 20000 }),
    R({ name: 'mid', repo: 'a/mid', stars: 300 }),
    R({ name: 'six', repo: 'a/six', stars: 6 }),
  ]
  const { top, rest, starsKnown } = rankRecos(items, 10)
  assert.equal(starsKnown, true)
  assert.deepEqual(top.map(x => x.name), ['big', 'mid'])
  assert.deepEqual(rest.map(x => x.name), ['six', 'zero']) // 별이 적은 것은 추천에서 빠지고 나머지로 내려간다
  assert.deepEqual(rankRecos(items, 10, 1).top.map(x => x.name), ['big']) // 1개만 뽑을 수도 있다
})

test('rankRecos: 별 0개·1개는 절대 추천이 되지 않는다', () => {
  const items = [R({ name: 'zero', repo: 'a/zero', stars: 0 }), R({ name: 'one', repo: 'a/one', stars: 1 })]
  assert.deepEqual(rankRecos(items, 10).top, [])
  assert.deepEqual(rankRecos(items, 0).top.map(x => x.name), ['one', 'zero']) // 기준을 0으로 내리면 뽑힌다 (사용자가 정한 경우만)
})

test('rankRecos: 검토된 출처는 별이 적어도 추천 후보가 된다', () => {
  const items = [
    R({ name: 'official', repo: 'o/official', tier: 'official', stars: 4 }),
    R({ name: 'popular', repo: 'p/popular', stars: 5000 }),
    R({ name: 'tiny', repo: 't/tiny', stars: 2 }),
  ]
  assert.deepEqual(rankRecos(items, 10).top.map(x => x.name), ['popular', 'official'])
})

test('rankRecos: 별을 아직 모르면 추천을 뽑지 않고, 출처 → 관련도 순으로 둔다', () => {
  const items = [
    R({ name: 'listed', repo: 'a/listed', rel: 9 }),
    R({ name: 'anthropic', repo: 'a/an', tier: 'anthropic', rel: 1 }),
    R({ name: 'listed2', repo: 'a/l2', rel: 3 }),
  ]
  const r = rankRecos(items, 10)
  assert.equal(r.starsKnown, false)
  assert.deepEqual(r.top, [])
  assert.deepEqual(r.rest.map(x => x.name), ['anthropic', 'listed', 'listed2'])
})

test('relevance: 이름·주제 3점, 설명 앞부분 2점, 설명 뒤쪽 1점', () => {
  const t = ['pdf', 'docx']
  assert.equal(relevance('pdf-mcp', 'Read things', t), 3) // 이름에 있다
  assert.equal(relevance('hyperframes', 'Write HTML. Render it.', ['video'], ['html-to-video', 'ffmpeg']), 3) // 만든 사람이 붙인 주제에 있다
  assert.equal(relevance('graphify', 'A knowledge graph tool', ['pdf'], ['ast', 'rag']), 0)
  assert.equal(relevance('Kami', 'Layout rules and templates for PDF reports', t), 2) // 설명 앞부분
  const late = 'Turn any codebase, with its docs, SQL schemas, configs, images and other files into a knowledge graph you can query, and export it as a PDF'
  assert.ok(late.toLowerCase().indexOf('pdf') > 100)
  assert.equal(relevance('graphify', late, t), 1) // 설명 뒤쪽에서만 언급: 곁다리
  assert.equal(relevance('x', 'nothing here', t), 0)
  assert.equal(relevance('X', 'DOCX files', t), 2) // 대소문자를 가리지 않는다
})

test('rankRecos: 별이 아무리 많아도 검색어가 곁다리로만 나오는 것은 추천 1·2위가 되지 않는다', () => {
  const items = [
    R({ name: 'graphify', repo: 'g/graphify', stars: 148000, rel: 2 }), // PDF를 입력 형식 중 하나로 언급
    R({ name: 'tail', repo: 't/tail', stars: 900000, rel: 1 }), // 설명 끝에서만 언급
    R({ name: 'pdf-mcp', repo: 'p/pdf-mcp', stars: 171, rel: 3 }),
    R({ name: 'compdf-skills', repo: 'c/compdf', stars: 110, rel: 3 }),
  ]
  const { top, rest } = rankRecos(items, 10)
  assert.deepEqual(top.map(x => x.name), ['pdf-mcp', 'compdf-skills']) // 밝힌 것(3점)이 별 수가 훨씬 많은 2점보다 먼저
  assert.deepEqual(rest.map(x => x.name), ['tail', 'graphify']) // 사라지지는 않고 나머지로 내려간다
})

test('rankRecos: 밝힌 것(3점)이 모자라면 설명 앞부분 언급(2점)으로 채운다', () => {
  const items = [
    R({ name: 'named', repo: 'n/named', stars: 50, rel: 3 }),
    R({ name: 'lead', repo: 'l/lead', stars: 5000, rel: 2 }),
    R({ name: 'late', repo: 'a/late', stars: 90000, rel: 1 }),
  ]
  assert.deepEqual(rankRecos(items, 10).top.map(x => x.name), ['named', 'lead'])
})

test('isLowStars: 검토되지 않았고 별이 기준보다 적은 것만', () => {
  assert.equal(isLowStars({ tier: 'listed', stars: 1 }, 10), true)
  assert.equal(isLowStars({ tier: 'github', stars: 9 }, 10), true)
  assert.equal(isLowStars({ tier: 'github', stars: 10 }, 10), false)
  assert.equal(isLowStars({ tier: 'partner', stars: 0 }, 10), false) // 검토된 출처
  assert.equal(isLowStars({ tier: 'listed' }, 10), false) // 별을 모르면 낮다고 단정하지 않는다
})

test('mergeRecos: 같은 저장소는 한 건으로, 별은 GitHub 값을 따른다', () => {
  const local = [R({ name: 'Remotion', repo: 'Remotion-Dev/claude-code-plugin', tier: 'listed', cmd: 'claude plugin marketplace add remotion-dev/claude-code-plugin', rel: 10 })]
  const github = [
    R({ name: 'remotion-dev/claude-code-plugin', repo: 'remotion-dev/claude-code-plugin', tier: 'github', source: 'github', stars: 83, forks: 35, flags: ['noLicense'], rel: 0 }),
    R({ name: 'other/repo', repo: 'other/repo', tier: 'github', source: 'github', stars: 500, rel: 0 }),
  ]
  const m = mergeRecos(local, github)
  assert.equal(m.length, 2)
  const one = m.find(x => x.repo.toLowerCase() === 'remotion-dev/claude-code-plugin')
  assert.equal(one.name, 'Remotion') // 이름은 디렉터리 쪽
  assert.equal(one.stars, 83) // 별은 GitHub 쪽
  assert.equal(one.tier, 'listed') // 출처 등급은 더 높은 쪽(listed > github)
  assert.equal(one.rel, 10)
  assert.deepEqual(one.flags, ['noLicense'])
  assert.ok(one.cmd.startsWith('claude plugin marketplace add'))
})

test('githubFlags: 주의 신호', () => {
  const now = Date.parse('2026-11-16T00:00:00Z')
  const base = { pushed_at: '2026-11-01T00:00:00Z', created_at: '2025-01-01T00:00:00Z', license: { spdx_id: 'MIT' }, fork: false, stargazers_count: 100, forks_count: 20 }
  assert.deepEqual(githubFlags(base, now), [])
  assert.deepEqual(githubFlags({ ...base, pushed_at: '2025-01-01T00:00:00Z' }, now), ['stale'])
  assert.deepEqual(githubFlags({ ...base, created_at: '2026-11-10T00:00:00Z' }, now), ['fresh'])
  assert.deepEqual(githubFlags({ ...base, license: null }, now), ['noLicense'])
  assert.deepEqual(githubFlags({ ...base, license: { spdx_id: 'NOASSERTION' } }, now), ['noLicense'])
  assert.deepEqual(githubFlags({ ...base, fork: true }, now), ['fork'])
  assert.deepEqual(githubFlags({ ...base, stargazers_count: 100000, forks_count: 10 }, now), ['ratio'])
  assert.deepEqual(githubFlags({ ...base, stargazers_count: 400, forks_count: 0 }, now), []) // 별이 적으면 비율을 보지 않는다
  assert.deepEqual(githubFlags({}, now), ['noLicense']) // 값이 비어도 깨지지 않는다
})

test('termHit: 짧은 검색어는 낱말 전체로, 긴 검색어는 부분 일치로', () => {
  assert.equal(termHit('ui-theme-designer', 'ui'), true)
  assert.equal(termHit('Rayden UI Design Skill', 'ui'), true)
  assert.equal(termHit('GUIDE Instructional Design', 'ui'), false) // guide 안의 ui는 아니다
  assert.equal(termHit('build quick suite', 'ui'), false)
  assert.equal(termHit('frontend-design', 'design'), true)
  assert.equal(termHit('UI Designer', 'design'), true) // 긴 검색어는 변형도 맞는다
  assert.equal(termHit('anything', ''), false)
  assert.equal(termHit('AI agents', 'ai'), true)
  assert.equal(termHit('maintain mail', 'ai'), false)
})

test('relevance: 짧은 검색어(ui)가 guide 같은 낱말 속에서 맞지 않는다', () => {
  assert.equal(relevance('GUIDE Instructional Design', 'Teaching guide', ['ui']), 0)
  assert.equal(relevance('ui-kit', 'Components', ['ui']), 3)
  assert.equal(relevance('frontend-design', 'Frontend design skill for UI/UX implementation', ['design', 'figma', 'ui']), 3)
})

test('safeRelPath: 플러그인 폴더 안의 안전한 상대 경로만', () => {
  assert.equal(safeRelPath('./.claude/skills/'), '.claude/skills')
  assert.equal(safeRelPath('./skills'), 'skills')
  assert.equal(safeRelPath('agents/reviewer.md'), 'agents/reviewer.md')
  assert.equal(safeRelPath('./a b/c-d_e.f'), 'a b/c-d_e.f')
  for (const bad of ['../x', './a/../../b', '/etc/passwd', 'C:/x', 'C:\\x', '~/x', 'a\\b', '', '.', './', '..', 'a/./..', 'a/b:c', 'a*b', 'x'.repeat(200), 'a/b/c/d/e/f/g/h/i', null, 5, undefined, ['a']]) {
    assert.equal(safeRelPath(bad), '', String(bad))
  }
})
