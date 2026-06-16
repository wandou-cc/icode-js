import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePushCommandArgs, resolvePushWorkflowOptions } from '../src/commands/push.js'

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
      aiProfile: 'ollama',
      aiCommitLang: 'en'
    }
  )

  assert.deepEqual(options, {
    targetBranches: ['dev', 'test'],
    message: 'fix: test',
    yes: false,
    remoteMerge: false,
    dryRun: false,
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
    dryRun: false,
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

test('push options support explicit remote merge flag', () => {
  const options = resolvePushWorkflowOptions(
    {
      'remote-merge': true
    },
    ['release'],
    {}
  )

  assert.equal(options.remoteMerge, true)
})

test('push options support explicit dry-run flag', () => {
  const options = resolvePushWorkflowOptions(
    {
      'dry-run': true
    },
    ['release'],
    {}
  )

  assert.equal(options.dryRun, true)
})

test('push command parses -r as remote merge flag', () => {
  const parsed = parsePushCommandArgs(['release', '-r'])

  assert.deepEqual(parsed.positionals, ['release'])
  assert.equal(parsed.values['remote-merge'], true)
})
