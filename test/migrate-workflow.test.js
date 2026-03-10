import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runCommand } from '../src/core/shell.js'
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
