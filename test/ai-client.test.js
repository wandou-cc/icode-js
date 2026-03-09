import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { askAi } from '../src/core/ai-client.js'
import { upsertAiProfile, useAiProfile } from '../src/core/ai-config.js'

test('ai-client supports ollama format without api key', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ai-client-test-'))
  process.env.ICODE_CONFIG_PATH = path.join(tempRoot, 'config.json')

  const originalFetch = global.fetch

  try {
    upsertAiProfile('ollama', {
      provider: 'ollama',
      format: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen2.5:7b'
    })
    useAiProfile('ollama')

    let captured = null
    global.fetch = async (url, options = {}) => {
      captured = {
        url,
        options
      }

      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            message: {
              content: 'pong'
            }
          })
        }
      }
    }

    const result = await askAi(
      {
        systemPrompt: 'system',
        userPrompt: 'user'
      },
      {
        profile: 'ollama'
      }
    )

    assert.equal(result, 'pong')
    assert.equal(captured.url, 'http://127.0.0.1:11434/api/chat')
    assert.equal(captured.options.headers.Authorization, undefined)

    const requestBody = JSON.parse(captured.options.body)
    assert.equal(requestBody.model, 'qwen2.5:7b')
    assert.equal(requestBody.stream, false)
    assert.equal(requestBody.options.num_predict, 1200)
    assert.equal(requestBody.messages.length, 2)
  } finally {
    global.fetch = originalFetch
    delete process.env.ICODE_CONFIG_PATH
  }
})

test('ai-client ollama can fallback to OLLAMA_HOST when baseUrl is empty', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ai-client-test-'))
  process.env.ICODE_CONFIG_PATH = path.join(tempRoot, 'config.json')
  process.env.OLLAMA_HOST = 'http://127.0.0.1:22434'

  const originalFetch = global.fetch

  try {
    upsertAiProfile('ollama-env', {
      provider: 'ollama',
      format: 'ollama',
      baseUrl: '',
      model: 'qwen2.5:7b'
    })
    useAiProfile('ollama-env')

    let capturedUrl = ''
    global.fetch = async (url) => {
      capturedUrl = url
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            response: 'pong'
          })
        }
      }
    }

    const result = await askAi(
      {
        systemPrompt: 'system',
        userPrompt: 'user'
      },
      {
        profile: 'ollama-env'
      }
    )

    assert.equal(result, 'pong')
    assert.equal(capturedUrl, 'http://127.0.0.1:22434/api/chat')
  } finally {
    global.fetch = originalFetch
    delete process.env.OLLAMA_HOST
    delete process.env.ICODE_CONFIG_PATH
  }
})
