import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runCommand } from '../src/core/shell.js'
import { upsertAiProfile, useAiProfile } from '../src/core/ai-config.js'
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
  await writeAndCommit(repoPath, 'target.txt', 'target\n', 'feat: target branch commit')
  await git(repoPath, ['push', '-u', 'origin', 'test'])

  await git(repoPath, ['checkout', defaultBranch])
  await git(repoPath, ['checkout', '-b', 'source'])
  await writeAndCommit(repoPath, 'source.txt', 'source\n', 'feat: source branch commit')

  return {
    remotePath,
    repoPath
  }
}

test('push-workflow uses local merge strategy by default for target branches', async () => {
  const fixture = await createRemoteMergeFixture()

  const result = await runPushWorkflow({
    cwd: fixture.repoPath,
    targetBranches: ['test'],
    yes: true,
    repoMode: 'auto'
  })

  assert.deepEqual(result.summary, [
    { branch: 'source', status: 'pushed' },
    { branch: 'test', status: 'merged-and-pushed' }
  ])
})

test('push-workflow with ai-commit commits and pushes untracked files without manual git add', async () => {
  const fixture = await createRemoteMergeFixture()
  process.env.ICODE_CONFIG_PATH = path.join(path.dirname(fixture.repoPath), 'config.json')
  const originalFetch = global.fetch

  try {
    fs.writeFileSync(path.join(fixture.repoPath, 'new-file.txt'), 'hello push workflow\n', 'utf8')

    upsertAiProfile('local', {
      provider: 'openai',
      format: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini'
    })
    useAiProfile('local')

    global.fetch = async () => ({
      ok: true,
      status: 200,
      headers: {
        forEach() {}
      },
      async text() {
        return JSON.stringify({
          choices: [
            {
              message: {
                content: '{"type":"feat","scope":"push","subject":"commit untracked file","body":""}'
              }
            }
          ]
        })
      }
    })

    const result = await runPushWorkflow({
      cwd: fixture.repoPath,
      yes: true,
      aiCommit: true,
      aiProfile: 'local',
      repoMode: 'auto'
    })

    assert.deepEqual(result.summary, [
      { branch: 'source', status: 'pushed' }
    ])

    const headFiles = await git(fixture.repoPath, ['show', '--name-only', '--format=', 'HEAD'])
    assert.match(headFiles.stdout, /new-file\.txt/)

    const remoteHeadFiles = await git(fixture.repoPath, ['show', '--name-only', '--format=', 'origin/source'])
    assert.match(remoteHeadFiles.stdout, /new-file\.txt/)

    const status = await git(fixture.repoPath, ['status', '--short'])
    assert.equal(status.stdout.trim(), '')
  } finally {
    global.fetch = originalFetch
    delete process.env.ICODE_CONFIG_PATH
  }
})
