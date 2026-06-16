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
    '--dryRun',
    '--dumpResponse',
    '--baseUrl=https://api.example.com/v1',
    '--apiKey=sk-test',
    '--maxTokens=1024',
    '--requestBody={"stream":false}',
    '--mergedTarget',
    '--forceProtected',
    '--localMerge',
    '--pullMain',
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
    '--dry-run',
    '--dump-response',
    '--base-url=https://api.example.com/v1',
    '--api-key=sk-test',
    '--max-tokens=1024',
    '--request-body={"stream":false}',
    '--merged-target',
    '--force-protected',
    '--local-merge',
    '--pull-main',
    '--remote-merge',
    '--no-verify',
    '--repo-mode',
    '--not-push-current',
    '--pull-main'
  ])
})
