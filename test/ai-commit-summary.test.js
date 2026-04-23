import assert from 'node:assert/strict'
import test from 'node:test'
import { formatAiCommitSummary } from '../src/core/ai/commit-summary.js'

test('formatAiCommitSummary preserves multiline commit message body', () => {
  const summary = formatAiCommitSummary('abc1234', 'feat(cli): support ai commit\n\nline1\nline2')

  assert.equal(summary, 'abc1234 feat(cli): support ai commit\n\nline1\nline2')
})

test('formatAiCommitSummary returns full message when commit id is empty', () => {
  const summary = formatAiCommitSummary('', 'fix: keep body\n\nbody line')

  assert.equal(summary, 'fix: keep body\n\nbody line')
})
