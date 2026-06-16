import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runCommand } from '../src/core/commands/shell.js'
import { setPlatformConfig } from '../src/core/config/store.js'
import { runDoctorWorkflow } from '../src/workflows/doctor-workflow.js'

// 初始化临时 Git 仓库，输入目录路径，输出已配置用户信息的仓库。
async function initRepo(repoPath) {
  fs.mkdirSync(repoPath, { recursive: true })
  await runCommand('git', ['init'], { cwd: repoPath })
  await runCommand('git', ['config', 'user.email', 'test@example.com'], { cwd: repoPath })
  await runCommand('git', ['config', 'user.name', 'test'], { cwd: repoPath })
}

test('doctor-workflow reports warnings for missing optional integrations', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-doctor-test-'))
  const repoPath = path.join(tempRoot, 'repo')
  const originalConfigPath = process.env.ICODE_CONFIG_PATH

  try {
    process.env.ICODE_CONFIG_PATH = path.join(tempRoot, 'config.json')
    await initRepo(repoPath)

    const result = await runDoctorWorkflow({
      cwd: repoPath,
      repoMode: 'auto'
    })

    assert.equal(result.summary.fail, 0)
    assert.ok(result.summary.warn >= 1)
    assert.equal(result.checks.find((check) => check.id === 'git.version')?.status, 'pass')
    assert.equal(result.checks.find((check) => check.id === 'git.origin')?.status, 'warn')
    assert.equal(result.checks.find((check) => check.id === 'ai.profile')?.status, 'warn')
    assert.equal(result.checks.find((check) => check.id === 'remoteMerge.config')?.status, 'warn')
  } finally {
    if (originalConfigPath == null) {
      delete process.env.ICODE_CONFIG_PATH
    } else {
      process.env.ICODE_CONFIG_PATH = originalConfigPath
    }
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('doctor-workflow passes remote merge check when platform config exists', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-doctor-test-'))
  const repoPath = path.join(tempRoot, 'repo')
  const originalConfigPath = process.env.ICODE_CONFIG_PATH

  try {
    process.env.ICODE_CONFIG_PATH = path.join(tempRoot, 'config.json')
    await initRepo(repoPath)
    await runCommand('git', ['remote', 'add', 'origin', 'git@gitlab.example.com:group/project.git'], { cwd: repoPath })
    setPlatformConfig('remoteMerge', {
      provider: 'gitlab',
      apiKey: 'rm_test_key'
    })

    const result = await runDoctorWorkflow({
      cwd: repoPath,
      repoMode: 'auto'
    })

    assert.equal(result.checks.find((check) => check.id === 'git.origin')?.status, 'pass')
    assert.equal(result.checks.find((check) => check.id === 'remoteMerge.config')?.status, 'pass')
  } finally {
    if (originalConfigPath == null) {
      delete process.env.ICODE_CONFIG_PATH
    } else {
      process.env.ICODE_CONFIG_PATH = originalConfigPath
    }
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})
