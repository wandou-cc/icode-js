import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { upsertAiProfile, useAiProfile } from '../src/core/ai/config.js'
import { runCommand } from '../src/core/commands/shell.js'
import { IcodeError } from '../src/core/errors.js'
import { runSaveCommand } from '../src/commands/save.js'
import { runSaveWorkflow } from '../src/workflows/save-workflow.js'

// 初始化带首个提交的临时仓库，输入目录路径，输出可用于 save 测试的仓库。
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

// 临时切换进程工作目录，输入目标目录，输出恢复函数。
function useTempCwd(cwd) {
  const originalCwd = process.cwd()
  process.chdir(cwd)

  return () => {
    process.chdir(originalCwd)
  }
}

// 临时启用 TTY spinner 并捕获 stderr，输入为空，输出捕获结果和恢复函数。
function captureSpinnerOutput() {
  const originalIsTTY = process.stderr.isTTY
  const originalWrite = process.stderr.write
  const originalNoSpinner = process.env.ICODE_NO_SPINNER
  let text = ''

  Object.defineProperty(process.stderr, 'isTTY', {
    value: true,
    configurable: true
  })
  delete process.env.ICODE_NO_SPINNER
  process.stderr.write = (chunk, encoding, callback) => {
    text += String(chunk)
    if (typeof encoding === 'function') {
      encoding()
    } else if (typeof callback === 'function') {
      callback()
    }
    return true
  }

  return {
    get text() {
      return text
    },
    restore() {
      process.stderr.write = originalWrite
      Object.defineProperty(process.stderr, 'isTTY', {
        value: originalIsTTY,
        configurable: true
      })
      if (originalNoSpinner == null) {
        delete process.env.ICODE_NO_SPINNER
        return
      }
      process.env.ICODE_NO_SPINNER = originalNoSpinner
    }
  }
}

test('save-workflow commits all changes with explicit message', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-save-test-'))
  const repoPath = path.join(tempRoot, 'repo')
  const restoreConfig = useTempConfig(path.join(tempRoot, 'config.json'))

  try {
    await initRepo(repoPath)
    fs.appendFileSync(path.join(repoPath, 'README.md'), 'changed\n', 'utf8')
    fs.writeFileSync(path.join(repoPath, 'new.txt'), 'new file\n', 'utf8')

    const result = await runSaveWorkflow({
      cwd: repoPath,
      repoMode: 'auto',
      message: 'feat: save changes'
    })

    assert.equal(result.applied, true)
    assert.equal(result.dryRun, false)
    assert.equal(result.commitMessage, 'feat: save changes')
    assert.match(result.commitId, /^[0-9a-f]+$/)

    const status = await runCommand('git', ['status', '--short'], { cwd: repoPath })
    assert.equal(status.stdout.trim(), '')

    const latest = await runCommand('git', ['log', '-1', '--format=%s'], { cwd: repoPath })
    assert.equal(latest.stdout.trim(), 'feat: save changes')
  } finally {
    restoreConfig()
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('save-workflow dry-run does not stage or commit changes', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-save-test-'))
  const repoPath = path.join(tempRoot, 'repo')
  const restoreConfig = useTempConfig(path.join(tempRoot, 'config.json'))

  try {
    await initRepo(repoPath)
    fs.appendFileSync(path.join(repoPath, 'README.md'), 'changed\n', 'utf8')
    fs.writeFileSync(path.join(repoPath, 'new.txt'), 'new file\n', 'utf8')

    const beforeHead = await runCommand('git', ['rev-parse', 'HEAD'], { cwd: repoPath })
    const result = await runSaveWorkflow({
      cwd: repoPath,
      repoMode: 'auto',
      message: 'feat: preview changes',
      dryRun: true
    })
    const afterHead = await runCommand('git', ['rev-parse', 'HEAD'], { cwd: repoPath })
    const status = await runCommand('git', ['status', '--short'], { cwd: repoPath })

    assert.equal(result.applied, false)
    assert.equal(result.dryRun, true)
    assert.equal(beforeHead.stdout.trim(), afterHead.stdout.trim())
    assert.match(status.stdout, /README\.md/)
    assert.match(status.stdout, /new\.txt/)
  } finally {
    restoreConfig()
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('save-workflow fails when repository has no changes', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-save-test-'))
  const repoPath = path.join(tempRoot, 'repo')
  const restoreConfig = useTempConfig(path.join(tempRoot, 'config.json'))

  try {
    await initRepo(repoPath)

    await assert.rejects(
      () => runSaveWorkflow({
        cwd: repoPath,
        repoMode: 'auto',
        message: 'chore: no changes'
      }),
      (error) => error instanceof IcodeError && error.code === 'SAVE_NO_CHANGES'
    )
  } finally {
    restoreConfig()
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('save-workflow uses AI commit path when explicitly requested', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-save-test-'))
  const repoPath = path.join(tempRoot, 'repo')
  const restoreConfig = useTempConfig(path.join(tempRoot, 'config.json'))
  const originalFetch = global.fetch

  try {
    await initRepo(repoPath)
    fs.writeFileSync(path.join(repoPath, 'ai.txt'), 'ai change\n', 'utf8')

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
                content: '{"type":"feat","scope":"save","subject":"commit ai changes","body":""}'
              }
            }
          ]
        })
      }
    })

    const result = await runSaveWorkflow({
      cwd: repoPath,
      repoMode: 'auto',
      aiCommit: true,
      profile: 'local',
      yes: true
    })

    assert.equal(result.applied, true)
    assert.equal(result.source, 'ai')
    assert.equal(result.commitMessage, 'feat(save): commit ai changes')

    const latest = await runCommand('git', ['log', '-1', '--format=%s'], { cwd: repoPath })
    assert.equal(latest.stdout.trim(), 'feat(save): commit ai changes')
  } finally {
    global.fetch = originalFetch
    restoreConfig()
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('save command ai-commit only shows AI request spinner like push command', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-save-test-'))
  const repoPath = path.join(tempRoot, 'repo')
  const restoreConfig = useTempConfig(path.join(tempRoot, 'config.json'))
  const originalFetch = global.fetch
  const captured = captureSpinnerOutput()
  let restoreCwd = null

  try {
    await initRepo(repoPath)
    restoreCwd = useTempCwd(repoPath)
    fs.writeFileSync(path.join(repoPath, 'command-ai.txt'), 'ai command change\n', 'utf8')

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
                content: '{"type":"feat","scope":"save","subject":"commit command ai changes","body":""}'
              }
            }
          ]
        })
      }
    })

    await runSaveCommand(['--ai-commit', '-y'])

    assert.match(captured.text, /等待响应/)
    assert.doesNotMatch(captured.text, /生成提交信息并保存改动/)
  } finally {
    captured.restore()
    if (restoreCwd) {
      restoreCwd()
    }
    global.fetch = originalFetch
    restoreConfig()
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})
