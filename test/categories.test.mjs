// 실행: node --test test/
// 플러그인·스킬을 용도별로 묶는 규칙 시험. Claude Code 없이 단독으로 돈다. (Node 23.6 이상)
import test from 'node:test'
import assert from 'node:assert/strict'
import { categorize, CATEGORY_ORDER, CATEGORY_KEYWORDS } from '../hooks/categories.ts'

const P = (name, description = '', skills = [], agents = []) => ({
  name,
  description,
  skills: skills.map(s => (typeof s === 'string' ? { name: s, description: '' } : s)),
  agents: agents.map(a => ({ name: a })),
})

test('이름이 분명한 것은 그 용도로', () => {
  assert.equal(categorize(P('remotion', 'Create a new Remotion video')), 'video')
  assert.equal(categorize(P('hyperframes', 'HTML rendered to video', ['video-captions'])), 'video')
  assert.equal(categorize(P('cloud-sql-mysql', 'Connect to a Cloud SQL for MySQL database')), 'data')
})

test('이름이 정확히 용도와 같으면, 안에 든 스킬 설명에 개발 단어가 많아도 이름이 이긴다', () => {
  const box = P('box', 'Box Platform integrations', [
    { name: 'box-sdk-development', description: 'Build with the Box SDK and API, debug code with the cli' },
    { name: 'box-cli', description: 'Use the Box CLI and API to manage code and tests' },
    { name: 'box-mcp', description: 'Debug the API with the sdk' },
  ])
  assert.equal(categorize(box), 'files')
})

test('스킬 이름에 든 보안 단어가 많은 에이전트 묶음은 보안으로', () => {
  const p = P('ai-plugins', 'Workflow agents and setup for Claude Code', ['setup'], ['ai-sast-remediation', 'malware-responder', 'vulnerability-explainer'])
  assert.equal(categorize(p), 'security')
})

test('자막·기획 같은 한국어 단어도 알아본다', () => {
  assert.equal(categorize(P('x', '영상에 자막을 넣고 받아쓰기를 해 줍니다')), 'captions')
  assert.equal(categorize(P('y', '기획서와 회의 메모를 정리하고 문서를 만듭니다')), 'planning')
})

test('모르는 것은 억지로 넣지 않고 기타로', () => {
  assert.equal(categorize(P('find-skills', 'Helps users discover and install agent skills')), 'other')
  assert.equal(categorize(P('zzz', '')), 'other')
})

test("짧은 영어 단어는 다른 단어 속에서 찾지 않는다 ('code'가 'barcode'에, 'git'이 'digit'에)", () => {
  assert.equal(categorize(P('scanner', 'Reads a barcode and a digit string')), 'other')
})

test('분류 목록과 사전이 서로 맞는다', () => {
  const keys = Object.keys(CATEGORY_KEYWORDS)
  assert.deepEqual([...keys].sort(), CATEGORY_ORDER.filter(k => k !== 'other').sort())
  for (const k of keys) assert.ok(CATEGORY_KEYWORDS[k].length >= 5, `${k} has too few keywords`)
})
