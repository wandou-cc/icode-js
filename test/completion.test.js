import assert from 'node:assert/strict'
import test from 'node:test'
import { getCompletionCandidates, renderCompletionScript } from '../src/core/cli/completion.js'

test('completion suggests top-level commands and global flags', () => {
  const candidates = getCompletionCandidates([], 'co')

  assert.deepEqual(candidates, ['codereview', 'config', 'completion'])
})

test('completion suggests ai subcommands', () => {
  const candidates = getCompletionCandidates(['ai'], '')

  assert.deepEqual(candidates, ['commit', 'conflict', 'codereview', 'review', 'explain', '--help', '-h'])
})

test('completion suggests enum values for pending option', () => {
  const candidates = getCompletionCandidates(['undo', '--mode'], 'r')

  assert.deepEqual(candidates, ['revert'])
})

test('completion supports inline option values', () => {
  const candidates = getCompletionCandidates(['undo'], '--mode=r')

  assert.deepEqual(candidates, ['--mode=revert'])
})

test('completion suggests refs for undo positional target', () => {
  const candidates = getCompletionCandidates(['undo'], 'a1', {
    listBranchCandidates: () => [],
    listRefCandidates: () => ['a1b2c3d', 'HEAD~1'],
    listAiProfileCandidates: () => []
  })

  assert.deepEqual(candidates, ['a1b2c3d'])
})

test('completion suggests branch candidates for repeated positionals', () => {
  const candidates = getCompletionCandidates(['push'], 're', {
    listBranchCandidates: () => ['release', 'release-hotfix', 'main'],
    listRefCandidates: () => [],
    listAiProfileCandidates: () => []
  })

  assert.deepEqual(candidates, ['release', 'release-hotfix'])
})

test('completion suggests configured ai profiles', () => {
  const candidates = getCompletionCandidates(['config', 'ai', 'use'], 'lo', {
    listBranchCandidates: () => [],
    listRefCandidates: () => [],
    listAiProfileCandidates: () => ['local', 'openai']
  })

  assert.deepEqual(candidates, ['local'])
})

test('completion renders bash and zsh scripts', () => {
  const bashScript = renderCompletionScript('bash')
  const zshScript = renderCompletionScript('zsh')

  assert.match(bashScript, /icode __complete --current/)
  assert.match(zshScript, /compdef _icode_completion icode/)
})
