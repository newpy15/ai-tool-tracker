import test from 'node:test'
import assert from 'node:assert/strict'
import * as u from '../hooks/usage.ts'

test('levelOf: 경계값', () => {
  assert.equal(u.levelOf(0), 'ok')
  assert.equal(u.levelOf(59.9), 'ok')
  assert.equal(u.levelOf(60), 'mid')
  assert.equal(u.levelOf(80), 'high')
  assert.equal(u.levelOf(95), 'full')
  assert.equal(u.levelOf(100), 'full')
})

test('levelColor: 여유는 초록, 절반은 노랑, 곧 한도부터 빨강', () => {
  assert.deepEqual(['ok', 'mid', 'high', 'full'].map(u.levelColor), ['success', 'warning', 'error', 'error'])
})

test('bar: 길이는 항상 같고 범위 밖 값도 안전', () => {
  assert.equal(u.bar(0), '░'.repeat(10))
  assert.equal(u.bar(32), '███░░░░░░░')
  assert.equal(u.bar(100), '█'.repeat(10))
  assert.equal(u.bar(250).length, 10)
  assert.equal(u.bar(-9).length, 10)
})

test('pct: 숫자만, 0~100으로 맞춘다', () => {
  assert.equal(u.pct(23.5), 23.5)
  assert.equal(u.pct(140), 100)
  assert.equal(u.pct(-1), 0)
  for (const bad of ['5', NaN, Infinity, null, undefined]) assert.equal(u.pct(bad), undefined)
})

test('untilReset: 남은 시간, 지났으면 0, 이상한 값은 undefined', () => {
  const now = Date.parse('2026-11-16T10:00:00Z')
  assert.deepEqual(u.untilReset('2026-11-16T12:13:10Z', now), { h: 2, m: 14 })
  assert.deepEqual(u.untilReset('2026-11-16T09:00:00Z', now), { h: 0, m: 0 })
  assert.equal(u.untilReset('soon', now), undefined)
  assert.equal(u.untilReset(undefined, now), undefined)
})

test('pickWindow: 종류별로 찾고 값이 이상하면 없는 것', () => {
  const list = [{ kind: 'seven_day', percentUsed: 12 }, { kind: 'five_hour', percentUsed: 32.5, resetsAt: '2026-11-16T12:00:00Z' }, { kind: 'x', percentUsed: 'a' }]
  assert.deepEqual(u.pickWindow(list, 'five_hour'), { percent: 32.5, resetsAt: '2026-11-16T12:00:00Z' })
  assert.deepEqual(u.pickWindow(list, 'seven_day'), { percent: 12, resetsAt: undefined })
  assert.equal(u.pickWindow(list, 'x'), undefined)
  assert.equal(u.pickWindow(undefined, 'five_hour'), undefined)
  assert.equal(u.pickWindow([], 'five_hour'), undefined)
})

test('shouldWarn: 단계가 올라갈 때만, 같은 단계에서는 반복하지 않는다', () => {
  assert.equal(u.shouldWarn(undefined, 'ok'), false)
  assert.equal(u.shouldWarn('ok', 'mid'), false)
  assert.equal(u.shouldWarn('mid', 'high'), true)
  assert.equal(u.shouldWarn('high', 'high'), false)
  assert.equal(u.shouldWarn('high', 'full'), true)
  assert.equal(u.shouldWarn('full', 'full'), false)
  assert.equal(u.shouldWarn('full', 'high'), false)
  assert.equal(u.shouldWarn(undefined, 'high'), true)
})

test('overGuard: 7일·5시간 중 하나라도 넘으면 알리고, 값을 모르면 막지 않는다', () => {
  const l = (f, s) => [{ kind: 'five_hour', percentUsed: f }, { kind: 'seven_day', percentUsed: s }]
  assert.equal(u.overGuard(l(79, 10), 80), undefined)
  assert.deepEqual(u.overGuard(l(80, 10), 80), { kind: 'five_hour', percent: 80 })
  assert.deepEqual(u.overGuard(l(10, 85), 80), { kind: 'seven_day', percent: 85 })
  assert.equal(u.overGuard([], 50), undefined)
  assert.equal(u.overGuard(undefined, 50), undefined)
})

test('attribute: 스킬·에이전트·MCP 설명 토큰을 플러그인별로 모은다', () => {
  const bd = {
    skills: { skillFrontmatter: [
      { name: 'a', pluginName: 'remotion', tokens: 100 },
      { name: 'b', pluginName: 'remotion', tokens: 50 },
      { name: 'mine', tokens: 30 },
      { name: 'x', pluginName: 'other', tokens: 7 },
    ] },
    agents: [{ agentType: 'remotion:render', tokens: 20 }, { agentType: 'remotion-extra:z', tokens: 999 }, { agentType: 'Explore', tokens: 5 }],
    mcpTools: [
      { name: 't1', serverName: 'plugin:remotion:remotion', tokens: 40, isLoaded: true },
      { name: 't2', serverName: 'plugin_remotion_remotion', tokens: 10, isLoaded: false },
      { name: 't3', serverName: 'remotion', tokens: 1, isLoaded: true },
      { name: 't4', serverName: 'plugin:remotion-pro:srv', tokens: 500, isLoaded: true },
    ],
  }
  const r = u.attribute(bd, ['remotion', 'empty'])
  assert.deepEqual(r.plugins.remotion, { skills: 150, agents: 20, mcp: 41, total: 211 })
  assert.deepEqual(r.plugins.empty, { skills: 0, agents: 0, mcp: 0, total: 0 })
  assert.deepEqual(r.skills, { mine: 30 })
  assert.deepEqual(u.attribute(undefined, ['x']).plugins.x, { skills: 0, agents: 0, mcp: 0, total: 0 })
})
