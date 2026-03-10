import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runCommand } from '../src/core/shell.js'
import { upsertAiProfile, useAiProfile } from '../src/core/ai-config.js'
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
