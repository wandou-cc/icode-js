import assert from 'node:assert/strict'
import test from 'node:test'
import { GitService } from '../src/core/git/service.js'

test('git service pull passes explicit rebase flag when requested', async () => {
  const calls = []
  const git = new GitService({
    topLevelPath: process.cwd(),
    gitDir: '.git',
    commonDir: '.git'
  })
  git.exec = async (args) => {
    calls.push(args)
    return {
      stdout: '',
      stderr: '',
      exitCode: 0
    }
  }

  await git.pull('main', {
    rebase: true
  })
  await git.pull('main', {
    noRebase: true
  })

  assert.deepEqual(calls, [
    ['pull', 'origin', 'main', '--rebase'],
    ['pull', 'origin', 'main', '--no-rebase']
  ])
})
