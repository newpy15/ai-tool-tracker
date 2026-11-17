// plugin.json의 설정 항목(userConfig)과 코드가 서로 맞는지 점검한다: 항목을 추가하고 코드에서 읽는 것을 빠뜨리는 실수를 막는다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pj = JSON.parse(readFileSync(join(here, '..', '.claude-plugin', 'plugin.json'), 'utf8'))
const src = readFileSync(join(here, '..', 'hooks', 'register.tsx'), 'utf8')

test('userConfig의 모든 항목은 기본값이 선택지 안에 있다', () => {
  for (const [k, v] of Object.entries(pj.userConfig)) {
    assert.ok(Array.isArray(v.options) && v.options.length >= 2, `${k}: 선택지`)
    assert.ok(v.options.includes(v.default), `${k}: 기본값 ${v.default}이 선택지에 없음`)
  }
})

test('userConfig의 모든 항목을 코드(register)가 읽는다', () => {
  for (const k of Object.keys(pj.userConfig)) {
    assert.ok(src.includes(`(options as any)?.${k}`), `${k}: 코드에서 읽지 않음`)
  }
})

test('패널 자동 열기: 기본은 켬이고, 끄면 시작할 때 열지 않는다', () => {
  assert.deepEqual(pj.userConfig.autoOpen.options, ['yes', 'no'])
  assert.equal(pj.userConfig.autoOpen.default, 'yes')
  assert.ok(/if \(autoOpen\) void \$\.ui\.open\(/.test(src), 'session.start에서 autoOpen을 확인하지 않음')
})

test('환경 탭에서 바꾸는 설정 키가 userConfig에 있다', () => {
  for (const m of src.matchAll(/key: 'ai-tool-tracker\.([A-Za-z]+)'/g)) {
    assert.ok(pj.userConfig[m[1]], `${m[1]}: userConfig에 없음`)
  }
})
