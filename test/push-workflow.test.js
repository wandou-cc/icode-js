import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runCommand } from '../src/core/shell.js'
import { runPushWorkflow } from '../src/workflows/push-workflow.js'

async function git(cwd, args, options = {}) {
  return runCommand('git', args, { cwd, ...options })
}

async function gitStdout(cwd, args) {
  const result = await git(cwd, args)
  return result.stdout.trim()
}

async function initRepo(repoPath) {
  fs.mkdirSync(repoPath, { recursive: true })
  await git(repoPath, ['init'])
  await git(repoPath, ['config', 'user.email', 'test@example.com'])
  await git(repoPath, ['config', 'user.name', 'test'])
}

async function writeAndCommit(repoPath, fileName, content, message) {
  fs.writeFileSync(path.join(repoPath, fileName), content, 'utf8')
  await git(repoPath, ['add', '-A'])
  await git(repoPath, ['commit', '-m', message])
}

async function createRemoteMergeFixture(options = {}) {
  const { conflict = false } = options
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-push-workflow-test-'))
  const remotePath = path.join(tempRoot, 'remote.git')
  const repoPath = path.join(tempRoot, 'repo')

  await git(tempRoot, ['init', '--bare', remotePath])
  await initRepo(repoPath)
  await writeAndCommit(repoPath, 'shared.txt', 'base\n', 'chore: init')

  const defaultBranch = await gitStdout(repoPath, ['branch', '--show-current'])
  await git(repoPath, ['remote', 'add', 'origin', remotePath])
  await git(repoPath, ['push', '-u', 'origin', defaultBranch])

  await git(repoPath, ['checkout', '-b', 'test'])
  if (conflict) {
    await writeAndCommit(repoPath, 'shared.txt', 'target\n', 'feat: target branch commit')
  } else {
    await writeAndCommit(repoPath, 'target.txt', 'target\n', 'feat: target branch commit')
  }
  await git(repoPath, ['push', '-u', 'origin', 'test'])

  await git(repoPath, ['checkout', defaultBranch])
  await git(repoPath, ['checkout', '-b', 'source'])
  if (conflict) {
    await writeAndCommit(repoPath, 'shared.txt', 'source\n', 'feat: source branch commit')
  } else {
    await writeAndCommit(repoPath, 'source.txt', 'source\n', 'feat: source branch commit')
  }

  const sourceHead = await gitStdout(repoPath, ['rev-parse', 'HEAD'])

  return {
    remotePath,
    repoPath,
    sourceHead
  }
}

async function remoteStdout(remotePath, args) {
  const result = await runCommand('git', ['--git-dir', remotePath, ...args])
  return result.stdout.trim()
}

async function remoteBranchExists(remotePath, branchName) {
  const result = await runCommand(
    'git',
    ['--git-dir', remotePath, 'show-ref', '--verify', '--quiet', `refs/heads/${branchName}`],
    { allowFailure: true }
  )
  return result.exitCode === 0
}

test('push-workflow uses remote rebase strategy by default for target branches', async () => {
  const fixture = await createRemoteMergeFixture()

  const result = await runPushWorkflow({
    cwd: fixture.repoPath,
    targetBranches: ['test'],
    yes: true,
    repoMode: 'auto'
  })

  assert.deepEqual(result.summary, [
    { branch: 'source', status: 'pushed' },
    { branch: 'test', status: 'remote-rebased-and-pushed' }
  ])
})

test('push-workflow falls back to temporary rebase when remote merge is non-fast-forward', async () => {
  const fixture = await createRemoteMergeFixture()

  const result = await runPushWorkflow({
    cwd: fixture.repoPath,
    targetBranches: ['test'],
    yes: true,
    remoteMerge: true,
    repoMode: 'auto'
  })

  assert.deepEqual(result.summary, [
    { branch: 'source', status: 'pushed' },
    { branch: 'test', status: 'remote-rebased-and-pushed' }
  ])

  const localBranch = await gitStdout(fixture.repoPath, ['branch', '--show-current'])
  const localHead = await gitStdout(fixture.repoPath, ['rev-parse', 'HEAD'])
  const localTempBranches = await gitStdout(fixture.repoPath, ['branch', '--list', 'icode-tmp-rebase-*'])
  const remoteSourceHead = await remoteStdout(fixture.remotePath, ['rev-parse', 'refs/heads/source'])
  const remoteTestLog = await remoteStdout(fixture.remotePath, ['log', '--oneline', 'refs/heads/test', '-5'])

  assert.equal(localBranch, 'source')
  assert.equal(localHead, fixture.sourceHead)
  assert.equal(localTempBranches, '')
  assert.equal(remoteSourceHead, fixture.sourceHead)
  assert.match(remoteTestLog, /feat: target branch commit/)
  assert.match(remoteTestLog, /feat: source branch commit/)
})

test('push-workflow stops target push when temporary rebase hits conflicts', async () => {
  const fixture = await createRemoteMergeFixture({ conflict: true })

  const result = await runPushWorkflow({
    cwd: fixture.repoPath,
    targetBranches: ['test'],
    yes: true,
    remoteMerge: true,
    repoMode: 'auto'
  })

  assert.deepEqual(result.summary, [
    { branch: 'source', status: 'pushed' },
    { branch: 'test', status: 'remote-rebase-conflicted' }
  ])

  const localBranch = await gitStdout(fixture.repoPath, ['branch', '--show-current'])
  const localHead = await gitStdout(fixture.repoPath, ['rev-parse', 'HEAD'])
  const localTempBranches = await gitStdout(fixture.repoPath, ['branch', '--list', 'icode-tmp-rebase-*'])
  const remoteSourceHead = await remoteStdout(fixture.remotePath, ['rev-parse', 'refs/heads/source'])
  const remoteTestLog = await remoteStdout(fixture.remotePath, ['log', '--oneline', 'refs/heads/test', '-5'])

  assert.equal(localBranch, 'source')
  assert.equal(localHead, fixture.sourceHead)
  assert.equal(localTempBranches, '')
  assert.equal(remoteSourceHead, fixture.sourceHead)
  assert.match(remoteTestLog, /feat: target branch commit/)
  assert.doesNotMatch(remoteTestLog, /feat: source branch commit/)
})

test('push-workflow respects --not-push-current in remote merge mode', async () => {
  const fixture = await createRemoteMergeFixture()

  const result = await runPushWorkflow({
    cwd: fixture.repoPath,
    targetBranches: ['test'],
    yes: true,
    remoteMerge: true,
    notPushCurrent: true,
    repoMode: 'auto'
  })

  assert.deepEqual(result.summary, [
    { branch: 'test', status: 'remote-rebased-and-pushed' }
  ])

  const remoteSourceExists = await remoteBranchExists(fixture.remotePath, 'source')
  const remoteTestLog = await remoteStdout(fixture.remotePath, ['log', '--oneline', 'refs/heads/test', '-5'])

  assert.equal(remoteSourceExists, false)
  assert.match(remoteTestLog, /feat: target branch commit/)
  assert.match(remoteTestLog, /feat: source branch commit/)
})
