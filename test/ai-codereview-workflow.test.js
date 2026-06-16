import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runCommand } from '../src/core/commands/shell.js'
import { upsertAiProfile, useAiProfile } from '../src/core/ai/config.js'
import { runAiCodeReviewWorkflow } from '../src/workflows/ai-codereview-workflow.js'

test('ai-codereview falls back to uncommitted changes when range diff is empty', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ai-codereview-test-'))
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
                content: 'review-from-uncommitted'
              }
            }
          ]
        })
      }
    })

    const result = await runAiCodeReviewWorkflow({
      cwd: repoPath,
      baseRef: 'HEAD',
      headRef: 'HEAD',
      profile: 'local',
      repoMode: 'auto'
    })

    assert.equal(result.rangeSpec, 'uncommitted(staged+working-tree)')
    assert.equal(result.review, 'review-from-uncommitted')
  } finally {
    global.fetch = originalFetch
    delete process.env.ICODE_CONFIG_PATH
  }
})

test('ai-codereview defaults to uncommitted changes without base/head', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ai-codereview-test-'))
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

    await runCommand('git', ['checkout', '-b', 'feature/test'], { cwd: repoPath })
    fs.writeFileSync(path.join(repoPath, 'a.txt'), 'base\nworktree\n', 'utf8')

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
                content: 'review-from-default-uncommitted'
              }
            }
          ]
        })
      }
    })

    const result = await runAiCodeReviewWorkflow({
      cwd: repoPath,
      profile: 'local',
      repoMode: 'auto'
    })

    assert.equal(result.rangeSpec, 'uncommitted(staged+working-tree)')
    assert.equal(result.review, 'review-from-default-uncommitted')
  } finally {
    global.fetch = originalFetch
    delete process.env.ICODE_CONFIG_PATH
  }
})

test('ai-codereview falls back to local default branch when remote base is unavailable', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ai-codereview-test-'))
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
                content: 'review-from-local-default-branch'
              }
            }
          ]
        })
      }
    })

    const result = await runAiCodeReviewWorkflow({
      cwd: repoPath,
      headRef: 'HEAD',
      profile: 'local',
      repoMode: 'auto'
    })

    assert.equal(result.rangeSpec, `${defaultBranch}...HEAD`)
    assert.equal(result.review, 'review-from-local-default-branch')
  } finally {
    global.fetch = originalFetch
    delete process.env.ICODE_CONFIG_PATH
  }
})

test('ai-codereview prompt reports partial coverage for large multi-file diffs', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ai-codereview-test-'))
  const repoPath = path.join(tempRoot, 'repo')
  process.env.ICODE_CONFIG_PATH = path.join(tempRoot, 'config.json')

  const originalFetch = global.fetch

  try {
    fs.mkdirSync(repoPath, { recursive: true })
    await runCommand('git', ['init'], { cwd: repoPath })
    await runCommand('git', ['config', 'user.email', 'test@example.com'], { cwd: repoPath })
    await runCommand('git', ['config', 'user.name', 'test'], { cwd: repoPath })

    fs.writeFileSync(path.join(repoPath, 'base.txt'), 'base\n', 'utf8')
    await runCommand('git', ['add', '-A'], { cwd: repoPath })
    await runCommand('git', ['commit', '-m', 'chore: init'], { cwd: repoPath })

    fs.writeFileSync(path.join(repoPath, 'review-a.txt'), `${'review-a\n'.repeat(2500)}`, 'utf8')
    fs.writeFileSync(path.join(repoPath, 'review-b.txt'), `${'review-b\n'.repeat(2500)}`, 'utf8')

    upsertAiProfile('local', {
      provider: 'openai',
      format: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini'
    })
    useAiProfile('local')

    let capturedBody = null
    global.fetch = async (_url, options = {}) => {
      capturedBody = JSON.parse(options.body)
      return {
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
                  content: 'large-diff-review'
                }
              }
            ]
          })
        }
      }
    }

    const result = await runAiCodeReviewWorkflow({
      cwd: repoPath,
      profile: 'local',
      repoMode: 'auto'
    })

    assert.equal(result.review, 'large-diff-review')
    assert.equal(result.diffCoverage.truncated, true)
    assert.equal(result.diffCoverage.totalFiles, 2)
    assert.ok(result.diffCoverage.partialFiles + result.diffCoverage.omittedFiles > 0)
    assert.ok(capturedBody)
    assert.match(capturedBody.messages[1].content, /Diff Coverage: partial/)
    assert.match(capturedBody.messages[1].content, /Included partial file diffs:/)
    assert.match(capturedBody.messages[1].content, /Omitted file diffs:/)
    assert.match(capturedBody.messages[1].content, /treat omitted or partial file diffs as unknown/)
  } finally {
    global.fetch = originalFetch
    delete process.env.ICODE_CONFIG_PATH
  }
})
