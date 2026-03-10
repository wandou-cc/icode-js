import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  getAiCommandOptions,
  getAiProfile,
  listAiCommandOptions,
  listAiProfiles,
  removeAiCommandOptions,
  upsertAiCommandOptions,
  upsertAiProfile,
  useAiProfile
} from '../src/core/ai-config.js'

test('ai-config set/use/list profile flow', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ai-config-test-'))
  process.env.ICODE_CONFIG_PATH = path.join(tempRoot, 'config.json')

  try {
    upsertAiProfile('openai', {
      provider: 'openai',
      format: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini'
    })

    upsertAiProfile('ollama', {
      provider: 'ollama',
      format: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen2.5:7b',
      requestBody: {
        think: false,
        stream: false
      }
    })

    useAiProfile('ollama')
    const current = getAiProfile()
    assert.equal(current.name, 'ollama')
    assert.equal(current.format, 'ollama')
    assert.equal(current.baseUrl, 'http://127.0.0.1:11434')
    assert.equal(current.requestBody.think, false)
    assert.equal(current.requestBody.stream, false)

    const profiles = listAiProfiles()
    assert.equal(profiles.length, 2)
    assert.equal(profiles.find((item) => item.name === 'ollama')?.isActive, true)
    assert.equal(profiles.find((item) => item.name === 'ollama')?.hasApiKey, false)
  } finally {
    delete process.env.ICODE_CONFIG_PATH
  }
})

test('ai-config command options set/get/remove flow', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ai-options-test-'))
  process.env.ICODE_CONFIG_PATH = path.join(tempRoot, 'config.json')

  try {
    upsertAiCommandOptions('commit', {
      profile: 'local',
      lang: 'zh',
      yes: true
    })

    upsertAiCommandOptions('push', {
      aiCommit: true,
      aiProfile: 'local'
    })

    const commitOptions = getAiCommandOptions('commit')
    assert.equal(commitOptions.profile, 'local')
    assert.equal(commitOptions.lang, 'zh')
    assert.equal(commitOptions.yes, true)

    upsertAiCommandOptions('commit', {
      apply: true
    })
    const mergedCommitOptions = getAiCommandOptions('commit')
    assert.equal(mergedCommitOptions.apply, true)
    assert.equal(mergedCommitOptions.profile, 'local')

    const allOptions = listAiCommandOptions()
    assert.equal(allOptions.push.aiCommit, true)

    removeAiCommandOptions('push')
    assert.deepEqual(getAiCommandOptions('push'), {})
  } finally {
    delete process.env.ICODE_CONFIG_PATH
  }
})
