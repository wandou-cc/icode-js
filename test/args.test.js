import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeLegacyArgs } from '../src/core/args.js'

test('normalizeLegacyArgs maps legacy camel-case flags', () => {
  const normalized = normalizeLegacyArgs([
    '--allLocal',
    '--mergeMain',
    '--aiReview',
    '--aiProfile',
    '--aiCommit',
    '--noVerify',
    '--repoMode',
    '--notPushCurrent'
  ])

  assert.deepEqual(normalized, [
    '--all-local',
    '--merge-main',
    '--ai-review',
    '--ai-profile',
    '--ai-commit',
    '--no-verify',
    '--repo-mode',
    '--not-push-current'
  ])
})
