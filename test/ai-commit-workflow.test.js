import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runCommand } from '../src/core/shell.js'
import { upsertAiProfile, useAiProfile } from '../src/core/ai-config.js'
import { runAiCommitWorkflow } from '../src/workflows/ai-commit-workflow.js'

async function git(cwd, args, options = {}) {
  return runCommand('git', args, { cwd, ...options })
}

test('ai-commit includes local hook and commitlint conventions in AI prompt', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ai-commit-workflow-test-'))
  const repoPath = path.join(tempRoot, 'repo')
  process.env.ICODE_CONFIG_PATH = path.join(tempRoot, 'config.json')

  const originalFetch = global.fetch

  try {
    fs.mkdirSync(repoPath, { recursive: true })
    await git(repoPath, ['init'])
    await git(repoPath, ['config', 'user.email', 'test@example.com'])
    await git(repoPath, ['config', 'user.name', 'test'])

    fs.writeFileSync(path.join(repoPath, 'package.json'), JSON.stringify({
      name: 'demo-repo',
      scripts: {
        commitlint: 'commitlint --edit $1',
        lint: 'eslint .'
      },
      commitlint: {
        extends: ['@commitlint/config-conventional']
      }
    }, null, 2), 'utf8')

    fs.mkdirSync(path.join(repoPath, '.husky'), { recursive: true })
    fs.writeFileSync(path.join(repoPath, '.husky', 'commit-msg'), '#!/usr/bin/env sh\nnpx commitlint --edit "$1"\n', 'utf8')
    fs.writeFileSync(path.join(repoPath, 'commitlint.config.cjs'), `module.exports = {
  rules: {
    'scope-case': [2, 'always', 'lower-case'],
    'type-enum': [2, 'always', ['feat', 'fix', 'chore']]
  }
}
`, 'utf8')

    fs.writeFileSync(path.join(repoPath, 'a.txt'), 'line-1\n', 'utf8')
    await git(repoPath, ['add', '-A'])
    await git(repoPath, ['commit', '-m', 'chore: init'])

    fs.writeFileSync(path.join(repoPath, 'a.txt'), 'line-1\nline-2\n', 'utf8')

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
                  content: '{"type":"fix","scope":"preview","subject":"match repo commit rules","body":""}'
                }
              }
            ]
          })
        }
      }
    }

    const result = await runAiCommitWorkflow({
      cwd: repoPath,
      profile: 'local',
      repoMode: 'auto',
      apply: false,
      lang: 'en'
    })

    assert.equal(result.commitMessage, 'fix(preview): match repo commit rules')
    assert.ok(capturedBody)
    assert.match(capturedBody.messages[1].content, /Local commit conventions were detected/)
    assert.match(capturedBody.messages[1].content, /\.husky\/commit-msg/)
    assert.match(capturedBody.messages[1].content, /commitlint\.config\.cjs/)
    assert.match(capturedBody.messages[1].content, /scope-case/)
    assert.match(capturedBody.messages[1].content, /type-enum/)
    assert.match(capturedBody.messages[1].content, /package\.json/)
  } finally {
    global.fetch = originalFetch
    delete process.env.ICODE_CONFIG_PATH
  }
})
