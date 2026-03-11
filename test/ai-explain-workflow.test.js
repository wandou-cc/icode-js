import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runCommand } from '../src/core/shell.js'
import { upsertAiProfile, useAiProfile } from '../src/core/ai-config.js'
import { runAiExplainWorkflow } from '../src/workflows/ai-explain-workflow.js'

test('ai-explain falls back to uncommitted changes when range diff is empty', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ai-explain-test-'))
  const repoPath = path.join(tempRoot, 'repo')
  process.env.ICODE_CONFIG_PATH = path.join(tempRoot, 'config.json')

  const originalFetch = global.fetch

  try {
    fs.mkdirSync(repoPath, { recursive: true })
    await runCommand('git', ['init'], { cwd: repoPath })
    await runCommand('git', ['config', 'user.email', 'test@example.com'], { cwd: repoPath })
    await runCommand('git', ['config', 'user.name', 'test'], { cwd: repoPath })

    fs.writeFileSync(path.join(repoPath, 'a.txt'), 'line-1\n', 'utf8')
    await runCommand('git', ['add', '-A'], { cwd: repoPath })
    await runCommand('git', ['commit', '-m', 'chore: init'], { cwd: repoPath })

    fs.writeFileSync(path.join(repoPath, 'a.txt'), 'line-1\nline-2\n', 'utf8')

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
      async text() {
        return JSON.stringify({
          choices: [
            {
              message: {
                content: 'explain-from-uncommitted'
              }
            }
          ]
        })
      }
    })

    const result = await runAiExplainWorkflow({
      cwd: repoPath,
      baseRef: 'HEAD',
      headRef: 'HEAD',
      profile: 'local',
      repoMode: 'auto'
    })

    assert.equal(result.rangeSpec, 'uncommitted(staged+working-tree)')
    assert.equal(result.explanation, 'explain-from-uncommitted')
  } finally {
    global.fetch = originalFetch
    delete process.env.ICODE_CONFIG_PATH
  }
})

test('ai-explain falls back to local default branch when remote base is unavailable', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ai-explain-test-'))
  const repoPath = path.join(tempRoot, 'repo')
  process.env.ICODE_CONFIG_PATH = path.join(tempRoot, 'config.json')

  const originalFetch = global.fetch

  try {
    fs.mkdirSync(repoPath, { recursive: true })
    await runCommand('git', ['init'], { cwd: repoPath })
    await runCommand('git', ['config', 'user.email', 'test@example.com'], { cwd: repoPath })
    await runCommand('git', ['config', 'user.name', 'test'], { cwd: repoPath })

    fs.writeFileSync(path.join(repoPath, 'a.txt'), 'base\n', 'utf8')
    await runCommand('git', ['add', '-A'], { cwd: repoPath })
    await runCommand('git', ['commit', '-m', 'chore: init'], { cwd: repoPath })

    const defaultBranch = (await runCommand('git', ['branch', '--show-current'], { cwd: repoPath })).stdout.trim()

    await runCommand('git', ['checkout', '-b', 'feature/test'], { cwd: repoPath })
    fs.writeFileSync(path.join(repoPath, 'a.txt'), 'base\nfeature\n', 'utf8')
    await runCommand('git', ['add', '-A'], { cwd: repoPath })
    await runCommand('git', ['commit', '-m', 'feat: feature change'], { cwd: repoPath })

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
                content: 'explain-from-local-default-branch'
              }
            }
          ]
        })
      }
    })

    const result = await runAiExplainWorkflow({
      cwd: repoPath,
      profile: 'local',
      repoMode: 'auto'
    })

    assert.equal(result.rangeSpec, `${defaultBranch}...HEAD`)
    assert.equal(result.explanation, 'explain-from-local-default-branch')
  } finally {
    global.fetch = originalFetch
    delete process.env.ICODE_CONFIG_PATH
  }
})

test('ai-explain rejects invalid explicit head even when local edits exist', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ai-explain-test-'))
  const repoPath = path.join(tempRoot, 'repo')
  process.env.ICODE_CONFIG_PATH = path.join(tempRoot, 'config.json')

  const originalFetch = global.fetch

  try {
    fs.mkdirSync(repoPath, { recursive: true })
    await runCommand('git', ['init'], { cwd: repoPath })
    await runCommand('git', ['config', 'user.email', 'test@example.com'], { cwd: repoPath })
    await runCommand('git', ['config', 'user.name', 'test'], { cwd: repoPath })

    fs.writeFileSync(path.join(repoPath, 'a.txt'), 'base\n', 'utf8')
    await runCommand('git', ['add', '-A'], { cwd: repoPath })
    await runCommand('git', ['commit', '-m', 'chore: init'], { cwd: repoPath })

    fs.writeFileSync(path.join(repoPath, 'a.txt'), 'base\nworktree\n', 'utf8')

    upsertAiProfile('local', {
      provider: 'openai',
      format: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini'
    })
    useAiProfile('local')

    global.fetch = async () => {
      throw new Error('fetch should not be called when head ref is invalid')
    }

    await assert.rejects(
      runAiExplainWorkflow({
        cwd: repoPath,
        headRef: 'bad-ref',
        profile: 'local',
        repoMode: 'auto'
      }),
      (error) => {
        assert.equal(error.code, 'AI_DIFF_HEAD_INVALID')
        assert.match(error.message, /bad-ref/)
        return true
      }
    )
  } finally {
    global.fetch = originalFetch
    delete process.env.ICODE_CONFIG_PATH
  }
})
