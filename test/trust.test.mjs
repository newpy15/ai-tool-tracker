// 실행: node --test test/
// 추천 링크·명령이 안전한지 확인하는 시험. Claude Code 없이 단독으로 돈다. (Node 23.6 이상)
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clean, safeName, safeRepo, repoFromUrl, githubLink, ownerOf,
  tierFromReview, tierRank, githubFlags,
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
