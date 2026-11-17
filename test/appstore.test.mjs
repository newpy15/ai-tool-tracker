import test from 'node:test'
import assert from 'node:assert/strict'
import * as a from '../hooks/appstore.ts'
import { clean, repoFromUrl, ownerOf } from '../hooks/trust.ts'

test('cleanText는 trust.clean과 같은 결과를 낸다 (눈속임 글자, 줄바꿈, 길이)', () => {
  for (const s of ['  a\nb\t c ', 'x‮y​z', 'a'.repeat(300), '\u0000\u001f', 'ａｂｃ', '한글 日本語']) {
    assert.equal(a.cleanText(s, 200), clean(s, 200), JSON.stringify(s))
  }
})

test('ownerFromUrl은 trust의 ownerOf(repoFromUrl)와 같은 결과를 낸다', () => {
  for (const u of [
    'https://github.com/anthropics/knowledge-work-plugins',
    'https://github.com/a/b.git',
    'https://github.com/o/r/tree/main/x',
    'https://github.com/-bad/repo',
    'https://github.com/o/..',
    'http://github.com/o/r',
    'https://evil.com/github.com/o/r',
    'https://github.com/o',
    '',
    undefined,
  ]) {
    assert.equal(a.ownerFromUrl(u), ownerOf(repoFromUrl(u)), String(u))
  }
})

test('safeSegment / safePluginId: 경로를 거슬러 오르거나 이상한 글자는 거절', () => {
  assert.equal(a.safeSegment('1e39bb4b'), '1e39bb4b')
  assert.equal(a.safeSegment('claude_pzs8sxrjxfjjc'), 'claude_pzs8sxrjxfjjc')
  for (const bad of ['..', 'a/b', 'a\\b', '', '-x', 'a..b', 'x y', 5, null]) assert.equal(a.safeSegment(bad), '', String(bad))
  assert.equal(a.safePluginId('plugin_017cgAdoTFBFmY674qpVnyLQ'), 'plugin_017cgAdoTFBFmY674qpVnyLQ')
  for (const bad of ['plugin_', 'plugin_a/b', '../plugin_x', 'plug_x', 'plugin_x y', undefined]) assert.equal(a.safePluginId(bad), '', String(bad))
})

test('parseManifest: 안전한 항목만, 중복 제거, 이상한 값은 버린다', () => {
  const raw = {
    plugins: [
      { id: 'plugin_AAA', displayName: 'Design', marketplaceName: 'anthropic-plugin-directory', upstreamRepoUrl: 'https://github.com/anthropics/knowledge-work-plugins' },
      { id: 'plugin_AAA', displayName: '중복' },
      { id: 'plugin_BBB', displayName: 'Evil\n‮name', marketplaceName: 'm', upstreamRepoUrl: 'https://evil.com/x/y' },
      { id: '../etc', displayName: 'Bad id' },
      { id: 'plugin_CCC', displayName: '   ' },
      null,
    ],
  }
  const r = a.parseManifest(raw)
  assert.deepEqual(r.map(x => x.id), ['plugin_AAA', 'plugin_BBB'])
  assert.equal(r[0].owner, 'anthropics')
  assert.equal(r[1].owner, '')
  assert.ok(!/[\n‮]/.test(r[1].displayName))
  assert.deepEqual(a.parseManifest('not json'), [])
  assert.deepEqual(a.parseManifest(JSON.stringify(raw)).length, 2)
  assert.deepEqual(a.parseManifest(undefined), [])
})

test('parseManifest: 개수 제한', () => {
  const many = { plugins: Array.from({ length: 200 }, (_, i) => ({ id: `plugin_X${i}`, displayName: `p${i}` })) }
  assert.equal(a.parseManifest(many).length, a.MAX_APP_PLUGINS)
})

test('parsePluginJson / firstSentence', () => {
  assert.deepEqual(a.parsePluginJson('{"version":"1.2.0","description":"Make designs. Second sentence."}'), { version: '1.2.0', summary: 'Make designs.' })
  assert.deepEqual(a.parsePluginJson('oops'), { version: '', summary: '' })
  assert.equal(a.firstSentence('x'.repeat(200), 20).length, 21)
})

test('buildAppPlugin: 스킬 이름·설명도 정리하고 이름 없는 스킬은 버린다', () => {
  const ref = { id: 'plugin_A', displayName: 'Legal', marketplace: 'm', owner: 'o' }
  const p = a.buildAppPlugin(ref, '{"version":"1.0.0","description":"Review contracts."}', [
    { name: 'review\n', summary: 'Review a contract. More.' },
    { name: '  ', summary: 'x' },
  ], true)
  assert.equal(p.version, '1.0.0')
  assert.equal(p.summary, 'Review contracts.')
  assert.deepEqual(p.skills, [{ name: 'review', summary: 'Review a contract.' }])
  assert.equal(p.hasMcp, true)
})
