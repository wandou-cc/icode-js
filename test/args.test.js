import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeLegacyArgs } from '../src/core/cli/args.js'

test('normalizeLegacyArgs maps legacy camel-case flags', () => {
  const normalized = normalizeLegacyArgs([
    '--allLocal',
    '--mergeMain',
    '--aiReview',
    '--aiProfile',
    '--aiCommit',
    '--remoteMerge',
    '--noVerify',
    '--repoMode',
    '--notPushCurrent',
    '-pm'
  ])

  assert.deepEqual(normalized, [
    '--all-local',
    '--merge-main',
    '--ai-review',
    '--ai-profile',
    '--ai-commit',
    '--remote-merge',
    '--no-verify',
    '--repo-mode',
    '--not-push-current',
    '--pull-main'
  ])
})
