import assert from 'node:assert/strict'
import test from 'node:test'
import { resolvePushWorkflowOptions } from '../src/commands/push.js'

test('push options only enable boolean flags when passed on CLI', () => {
  const options = resolvePushWorkflowOptions(
    {
      message: 'fix: test'
    },
    ['dev', 'test'],
    {
      yes: true,
      aiCommit: true,
      pullMain: true,
      notPushCurrent: true,
      forceProtected: true,
      repoMode: 'strict',
      noVerify: true,
      localMerge: true,
      origin: false,
      aiProfile: 'ollama',
      aiCommitLang: 'en'
    }
  )

  assert.deepEqual(options, {
    targetBranches: ['dev', 'test'],
    message: 'fix: test',
    yes: false,
    remoteMerge: true,
    aiCommit: false,
    aiCommitLang: 'en',
    aiProfile: 'ollama',
    pullMain: false,
    notPushCurrent: false,
    forceProtected: false,
    repoMode: 'auto',
    noVerify: false
  })
})

test('push options respect explicit CLI flags', () => {
  const options = resolvePushWorkflowOptions(
    {
      message: 'fix: test',
      yes: true,
      'local-merge': true,
      'ai-commit': true,
      'ai-profile': 'custom-profile',
      'pull-main': true,
      'not-push-current': true,
      'force-protected': true,
      'repo-mode': 'strict',
      'no-verify': true
    },
    ['release'],
    {
      aiProfile: 'ollama',
      aiCommitLang: 'en'
    }
  )

  assert.deepEqual(options, {
    targetBranches: ['release'],
    message: 'fix: test',
    yes: true,
    remoteMerge: false,
    aiCommit: true,
    aiCommitLang: 'en',
    aiProfile: 'custom-profile',
    pullMain: true,
    notPushCurrent: true,
    forceProtected: true,
    repoMode: 'strict',
    noVerify: true
  })
})

test('push options keep local-merge higher priority than origin when both are set', () => {
  const options = resolvePushWorkflowOptions(
    {
      origin: true,
      'local-merge': true
    },
    []
  )

  assert.equal(options.remoteMerge, false)
})
