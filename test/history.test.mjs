import test from 'node:test'
import assert from 'node:assert/strict'
import * as h from '../hooks/history.ts'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-11-17T09:00:00Z')

test('parseHistory: 엉뚱한 값은 빈 기록으로, 이상한 이름과 미래 시각은 버린다', () => {
  assert.deepEqual(h.parseHistory(null, NOW), { since: NOW, items: {} })
  const r = h.parseHistory({
    since: NOW - 3 * DAY,
    items: { remotion: { last: NOW - DAY, count: 4 }, 'bad name': { last: NOW, count: 1 }, future: { last: NOW + 9 * DAY, count: 1 }, nan: { last: NaN, count: 1 }, noCount: { last: NOW - DAY } },
  }, NOW)
  assert.equal(r.since, NOW - 3 * DAY)
  assert.deepEqual(Object.keys(r.items).sort(), ['noCount', 'remotion'])
  assert.equal(r.items.noCount.count, 1)
  assert.equal(h.parseHistory({ since: NOW + DAY }, NOW).since, NOW)
})

test('record: 횟수와 마지막 시각을 갱신하고, 안전하지 않은 이름은 무시', () => {
  let x = h.emptyHistory(NOW - 20 * DAY)
  x = h.record(x, 'remotion', NOW - 5 * DAY)
  x = h.record(x, 'remotion', NOW)
  assert.deepEqual(x.items.remotion, { last: NOW, count: 2 })
  assert.equal(h.record(x, 'a;b', NOW), x)
  assert.equal(h.record(x, '', NOW), x)
})

test('record: 이름이 너무 많이 쌓이면 새 이름은 받지 않는다', () => {
  let x = h.emptyHistory(NOW)
  for (let i = 0; i < h.MAX_ITEMS + 10; i++) x = h.record(x, `p${i}`, NOW)
  assert.equal(Object.keys(x.items).length, h.MAX_ITEMS)
  assert.equal(h.record(x, 'p0', NOW).items.p0.count, 2) // 이미 있는 것은 계속 갱신
})

test('merge: 더 이른 시작, 더 늦은 사용, 더 큰 횟수', () => {
  const a = { since: NOW - 10 * DAY, items: { x: { last: NOW - 2 * DAY, count: 5 } } }
  const b = { since: NOW - 30 * DAY, items: { x: { last: NOW - DAY, count: 3 }, y: { last: NOW, count: 1 } } }
  assert.deepEqual(h.merge(a, b), { since: NOW - 30 * DAY, items: { x: { last: NOW - DAY, count: 5 }, y: { last: NOW, count: 1 } } })
})

test('unusedList: 기록 기간이 모자라면 판단하지 않는다', () => {
  const x = h.emptyHistory(NOW - 3 * DAY)
  const r = h.unusedList(x, ['a', 'b'], NOW, 14)
  assert.equal(r.ready, false)
  assert.equal(r.trackedDays, 3)
  assert.deepEqual(r.list, [])
})

test('unusedList: 기간이 지나면 안 쓴 것을 오래된 순으로, 한 번도 없는 것을 앞에', () => {
  let x = h.emptyHistory(NOW - 40 * DAY)
  x = h.record(x, 'old', NOW - 20 * DAY)
  x = h.record(x, 'older', NOW - 35 * DAY)
  x = h.record(x, 'recent', NOW - 2 * DAY)
  const r = h.unusedList(x, ['recent', 'old', 'older', 'never'], NOW, 14)
  assert.equal(r.ready, true)
  assert.deepEqual(r.list, [{ name: 'never' }, { name: 'older', lastDays: 35 }, { name: 'old', lastDays: 20 }])
})

test('unusedList: 경계 — 정확히 days일 전이면 안 쓴 것으로 본다', () => {
  let x = h.emptyHistory(NOW - 30 * DAY)
  x = h.record(x, 'edge', NOW - 14 * DAY)
  assert.deepEqual(h.unusedList(x, ['edge'], NOW, 14).list, [{ name: 'edge', lastDays: 14 }])
  x = h.record(x, 'edge', NOW - 14 * DAY + 1000)
  assert.deepEqual(h.unusedList(x, ['edge'], NOW, 14).list, [])
})

test('DAY_OPTIONS에 기본값이 들어 있다', () => {
  assert.ok(h.DAY_OPTIONS.includes(h.DEFAULT_DAYS))
})
