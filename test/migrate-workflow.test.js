import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runCommand } from '../src/core/commands/shell.js'
import { runMigrateWorkflow } from '../src/workflows/migrate-workflow.js'

test('migrate-workflow supports selected commits migration', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-migrate-workflow-test-'))
  const repoPath = path.join(tempRoot, 'repo')

  fs.mkdirSync(repoPath, { recursive: true })
  await runCommand('git', ['init'], { cwd: repoPath })
  await runCommand('git', ['config', 'user.email', 'test@example.com'], { cwd: repoPath })
  await runCommand('git', ['config', 'user.name', 'test'], { cwd: repoPath })

  fs.writeFileSync(path.join(repoPath, 'base.txt'), 'base\n', 'utf8')
  await runCommand('git', ['add', '-A'], { cwd: repoPath })
  await runCommand('git', ['commit', '-m', 'chore: init'], { cwd: repoPath })

  await runCommand('git', ['checkout', '-b', 'target'], { cwd: repoPath })
  await runCommand('git', ['checkout', '-b', 'source'], { cwd: repoPath })

  fs.writeFileSync(path.join(repoPath, 'a.txt'), 'a\n', 'utf8')
  await runCommand('git', ['add', '-A'], { cwd: repoPath })
  await runCommand('git', ['commit', '-m', 'feat: add a'], { cwd: repoPath })

  fs.writeFileSync(path.join(repoPath, 'b.txt'), 'b\n', 'utf8')
  await runCommand('git', ['add', '-A'], { cwd: repoPath })
  await runCommand('git', ['commit', '-m', 'feat: add b'], { cwd: repoPath })

  const commitListResult = await runCommand('git', ['rev-list', '--reverse', 'target..source'], { cwd: repoPath })
  const commits = commitListResult.stdout
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)

  assert.equal(commits.length, 2)

  const result = await runMigrateWorkflow({
    cwd: repoPath,
    sourceBranch: 'source',
    targetBranch: 'target',
    selectedCommits: [commits[1]],
    yes: true,
    repoMode: 'auto'
  })

  assert.equal(result.migratedCommits, 1)
  assert.equal(result.rangeMode, 'selected-commits')

  const targetLogResult = await runCommand('git', ['log', '--oneline', 'target', '-6'], { cwd: repoPath })
  assert.ok(targetLogResult.stdout.includes('feat: add b'))
  assert.ok(!targetLogResult.stdout.includes('feat: add a'))
})

test('migrate-workflow dry-run returns plan without checkout or cherry-pick', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-migrate-workflow-test-'))
  const repoPath = path.join(tempRoot, 'repo')

  try {
    fs.mkdirSync(repoPath, { recursive: true })
    await runCommand('git', ['init'], { cwd: repoPath })
    await runCommand('git', ['config', 'user.email', 'test@example.com'], { cwd: repoPath })
    await runCommand('git', ['config', 'user.name', 'test'], { cwd: repoPath })

    fs.writeFileSync(path.join(repoPath, 'base.txt'), 'base\n', 'utf8')
    await runCommand('git', ['add', '-A'], { cwd: repoPath })
    await runCommand('git', ['commit', '-m', 'chore: init'], { cwd: repoPath })
    await runCommand('git', ['checkout', '-b', 'target'], { cwd: repoPath })
    await runCommand('git', ['checkout', '-b', 'source'], { cwd: repoPath })

    fs.writeFileSync(path.join(repoPath, 'feature.txt'), 'feature\n', 'utf8')
    await runCommand('git', ['add', '-A'], { cwd: repoPath })
    await runCommand('git', ['commit', '-m', 'feat: feature change'], { cwd: repoPath })

    const beforeBranch = (await runCommand('git', ['branch', '--show-current'], { cwd: repoPath })).stdout.trim()
    const result = await runMigrateWorkflow({
      cwd: repoPath,
      sourceBranch: 'source',
      targetBranch: 'target',
      dryRun: true,
      yes: true,
      repoMode: 'auto',
      silentLog: true
    })
    const afterBranch = (await runCommand('git', ['branch', '--show-current'], { cwd: repoPath })).stdout.trim()
    const targetFiles = await runCommand('git', ['ls-tree', '--name-only', 'target'], { cwd: repoPath })

    assert.equal(result.dryRun, true)
    assert.equal(result.migratedCommits, 1)
    assert.equal(result.commits[0].summary.includes('feat: feature change'), true)
    assert.equal(beforeBranch, 'source')
    assert.equal(afterBranch, 'source')
    assert.equal(targetFiles.stdout.includes('feature.txt'), false)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('migrate-workflow rejects dirty worktree before checkout', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-migrate-workflow-test-'))
  const repoPath = path.join(tempRoot, 'repo')

  try {
    fs.mkdirSync(repoPath, { recursive: true })
    await runCommand('git', ['init'], { cwd: repoPath })
    await runCommand('git', ['config', 'user.email', 'test@example.com'], { cwd: repoPath })
    await runCommand('git', ['config', 'user.name', 'test'], { cwd: repoPath })

    fs.writeFileSync(path.join(repoPath, 'base.txt'), 'base\n', 'utf8')
    await runCommand('git', ['add', '-A'], { cwd: repoPath })
    await runCommand('git', ['commit', '-m', 'chore: init'], { cwd: repoPath })
    await runCommand('git', ['checkout', '-b', 'target'], { cwd: repoPath })
    await runCommand('git', ['checkout', '-b', 'source'], { cwd: repoPath })
    fs.writeFileSync(path.join(repoPath, 'dirty.txt'), 'dirty\n', 'utf8')

    await assert.rejects(
      () => runMigrateWorkflow({
        cwd: repoPath,
        sourceBranch: 'source',
        targetBranch: 'target',
        yes: true,
        repoMode: 'auto',
        silentLog: true
      }),
      (error) => error.code === 'MIGRATE_DIRTY_WORKTREE'
    )

    const branch = (await runCommand('git', ['branch', '--show-current'], { cwd: repoPath })).stdout.trim()
    assert.equal(branch, 'source')
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('migrate-workflow skips checkout when there are no commits to migrate', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-migrate-workflow-test-'))
  const repoPath = path.join(tempRoot, 'repo')
  const remotePath = path.join(tempRoot, 'remote.git')

  try {
    await runCommand('git', ['init', '--bare', remotePath])
    fs.mkdirSync(repoPath, { recursive: true })
    await runCommand('git', ['init'], { cwd: repoPath })
    await runCommand('git', ['config', 'user.email', 'test@example.com'], { cwd: repoPath })
    await runCommand('git', ['config', 'user.name', 'test'], { cwd: repoPath })
    await runCommand('git', ['remote', 'add', 'origin', remotePath], { cwd: repoPath })

    fs.writeFileSync(path.join(repoPath, 'base.txt'), 'base\n', 'utf8')
    await runCommand('git', ['add', '-A'], { cwd: repoPath })
    await runCommand('git', ['commit', '-m', 'chore: init'], { cwd: repoPath })
    await runCommand('git', ['checkout', '-b', 'source'], { cwd: repoPath })
    await runCommand('git', ['push', 'origin', 'source'], { cwd: repoPath })
    await runCommand('git', ['push', 'origin', 'source:target'], { cwd: repoPath })

    const result = await runMigrateWorkflow({
      cwd: repoPath,
      sourceBranch: 'source',
      targetBranch: 'target',
      yes: true,
      repoMode: 'auto',
      silentLog: true
    })

    const branch = (await runCommand('git', ['branch', '--show-current'], { cwd: repoPath })).stdout.trim()
    const localTarget = await runCommand('git', ['branch', '--list', 'target'], {
      cwd: repoPath,
      allowFailure: true
    })

    assert.equal(result.migratedCommits, 0)
    assert.equal(branch, 'source')
    assert.equal(localTarget.stdout.trim(), '')
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})
