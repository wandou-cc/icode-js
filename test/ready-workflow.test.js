import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runCommand } from '../src/core/commands/shell.js'
import { runReadyWorkflow } from '../src/workflows/ready-workflow.js'

// 初始化带首个提交的临时仓库，输入目录路径，输出可用于 ready 测试的仓库。
async function initRepo(repoPath) {
  fs.mkdirSync(repoPath, { recursive: true })
  await runCommand('git', ['init'], { cwd: repoPath })
  await runCommand('git', ['config', 'user.email', 'test@example.com'], { cwd: repoPath })
  await runCommand('git', ['config', 'user.name', 'test'], { cwd: repoPath })
  fs.writeFileSync(path.join(repoPath, 'README.md'), '# demo\n', 'utf8')
  await runCommand('git', ['add', '-A'], { cwd: repoPath })
  await runCommand('git', ['commit', '-m', 'chore: init'], { cwd: repoPath })
}

// 临时切换 iCode 配置文件，输入路径，输出恢复函数。
function useTempConfig(configPath) {
  const originalConfigPath = process.env.ICODE_CONFIG_PATH
  process.env.ICODE_CONFIG_PATH = configPath

  return () => {
    if (originalConfigPath == null) {
      delete process.env.ICODE_CONFIG_PATH
      return
    }
    process.env.ICODE_CONFIG_PATH = originalConfigPath
  }
}

test('ready-workflow reports clean repository with warning integrations', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ready-test-'))
  const repoPath = path.join(tempRoot, 'repo')
  const restoreConfig = useTempConfig(path.join(tempRoot, 'config.json'))

  try {
    await initRepo(repoPath)

    const result = await runReadyWorkflow({
      cwd: repoPath,
      repoMode: 'auto'
    })

    assert.equal(result.changes.clean, true)
    assert.equal(result.context.currentBranch.length > 0, true)
    assert.equal(result.checks.find((check) => check.id === 'git.branch')?.status, 'pass')
    assert.equal(result.checks.find((check) => check.id === 'git.changes')?.status, 'pass')
    assert.equal(result.checks.find((check) => check.id === 'git.upstream')?.status, 'warn')
    assert.equal(result.status, 'warn')
    assert.equal(result.ok, true)
  } finally {
    restoreConfig()
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('ready-workflow reports unstaged and untracked changes', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ready-test-'))
  const repoPath = path.join(tempRoot, 'repo')
  const restoreConfig = useTempConfig(path.join(tempRoot, 'config.json'))

  try {
    await initRepo(repoPath)
    fs.appendFileSync(path.join(repoPath, 'README.md'), 'changed\n', 'utf8')
    fs.writeFileSync(path.join(repoPath, 'new.txt'), 'new file\n', 'utf8')

    const result = await runReadyWorkflow({
      cwd: repoPath,
      repoMode: 'auto'
    })

    assert.equal(result.changes.clean, false)
    assert.equal(result.changes.unstaged, 1)
    assert.equal(result.changes.untracked, 1)
    assert.equal(result.checks.find((check) => check.id === 'git.changes')?.status, 'warn')
    assert.match(result.nextSteps.join('\n'), /icode save/)
  } finally {
    restoreConfig()
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('ready-workflow reports upstream ahead and behind counts', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ready-test-'))
  const remotePath = path.join(tempRoot, 'remote.git')
  const repoPath = path.join(tempRoot, 'repo')
  const otherPath = path.join(tempRoot, 'other')
  const restoreConfig = useTempConfig(path.join(tempRoot, 'config.json'))

  try {
    await runCommand('git', ['init', '--bare', remotePath], { cwd: tempRoot })
    await initRepo(repoPath)
    const branch = (await runCommand('git', ['branch', '--show-current'], { cwd: repoPath })).stdout.trim()
    await runCommand('git', ['remote', 'add', 'origin', remotePath], { cwd: repoPath })
    await runCommand('git', ['push', '--set-upstream', 'origin', branch], { cwd: repoPath })

    await runCommand('git', ['clone', remotePath, otherPath], { cwd: tempRoot })
    await runCommand('git', ['config', 'user.email', 'other@example.com'], { cwd: otherPath })
    await runCommand('git', ['config', 'user.name', 'other'], { cwd: otherPath })
    fs.writeFileSync(path.join(otherPath, 'remote.txt'), 'remote\n', 'utf8')
    await runCommand('git', ['add', '-A'], { cwd: otherPath })
    await runCommand('git', ['commit', '-m', 'feat: remote change'], { cwd: otherPath })
    await runCommand('git', ['push'], { cwd: otherPath })

    fs.writeFileSync(path.join(repoPath, 'local.txt'), 'local\n', 'utf8')
    await runCommand('git', ['add', '-A'], { cwd: repoPath })
    await runCommand('git', ['commit', '-m', 'feat: local change'], { cwd: repoPath })
    await runCommand('git', ['fetch'], { cwd: repoPath })

    const result = await runReadyWorkflow({
      cwd: repoPath,
      repoMode: 'auto'
    })

    assert.equal(result.upstream.configured, true)
    assert.equal(result.upstream.ahead, 1)
    assert.equal(result.upstream.behind, 1)
    assert.equal(result.checks.find((check) => check.id === 'git.upstream')?.status, 'warn')
  } finally {
    restoreConfig()
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('ready-workflow reports pending merge after conflicts are staged', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ready-test-'))
  const repoPath = path.join(tempRoot, 'repo')
  const restoreConfig = useTempConfig(path.join(tempRoot, 'config.json'))

  try {
    await initRepo(repoPath)
    fs.writeFileSync(path.join(repoPath, 'conflict.txt'), 'base\n', 'utf8')
    await runCommand('git', ['add', '-A'], { cwd: repoPath })
    await runCommand('git', ['commit', '-m', 'chore: add conflict file'], { cwd: repoPath })
    const defaultBranch = (await runCommand('git', ['branch', '--show-current'], { cwd: repoPath })).stdout.trim()

    await runCommand('git', ['checkout', '-b', 'other'], { cwd: repoPath })
    fs.writeFileSync(path.join(repoPath, 'conflict.txt'), 'other\n', 'utf8')
    await runCommand('git', ['commit', '-am', 'feat: other change'], { cwd: repoPath })

    await runCommand('git', ['checkout', defaultBranch], { cwd: repoPath })
    fs.writeFileSync(path.join(repoPath, 'conflict.txt'), 'main\n', 'utf8')
    await runCommand('git', ['commit', '-am', 'feat: main change'], { cwd: repoPath })
    await runCommand('git', ['merge', 'other'], { cwd: repoPath, allowFailure: true })
    fs.writeFileSync(path.join(repoPath, 'conflict.txt'), 'resolved\n', 'utf8')
    await runCommand('git', ['add', 'conflict.txt'], { cwd: repoPath })

    const result = await runReadyWorkflow({
      cwd: repoPath,
      repoMode: 'auto'
    })

    assert.equal(result.operation, 'merge')
    assert.equal(result.changes.conflicted, 0)
    assert.equal(result.checks.find((check) => check.id === 'git.operation')?.status, 'fail')
    assert.match(result.checks.find((check) => check.id === 'git.operation')?.detail || '', /merge/)
  } finally {
    restoreConfig()
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})
