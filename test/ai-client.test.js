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

test('ai-client ollama supports openai-compatible response payload', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ai-client-test-'))
  process.env.ICODE_CONFIG_PATH = path.join(tempRoot, 'config.json')

  const originalFetch = global.fetch

  try {
    upsertAiProfile('ollama-openai', {
      provider: 'ollama',
      format: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'glm-5:cloud'
    })
    useAiProfile('ollama-openai')

    global.fetch = async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          choices: [
            {
              message: {
                content: 'review-result'
              }
            }
          ]
        })
      }
    })

    const result = await askAi(
      {
        systemPrompt: 'system',
        userPrompt: 'user'
      },
      {
        profile: 'ollama-openai'
      }
    )

    assert.equal(result, 'review-result')
  } finally {
    global.fetch = originalFetch
    delete process.env.ICODE_CONFIG_PATH
  }
})

test('ai-client ollama empty response should expose raw response in meta', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ai-client-test-'))
  process.env.ICODE_CONFIG_PATH = path.join(tempRoot, 'config.json')

  const originalFetch = global.fetch

  try {
    upsertAiProfile('ollama-empty', {
      provider: 'ollama',
      format: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'glm-5:cloud'
    })
    useAiProfile('ollama-empty')

    global.fetch = async () => ({
      ok: true,
      status: 200,
      headers: {
        forEach(callback) {
          callback('application/json', 'content-type')
        }
      },
      async text() {
        return JSON.stringify({
          done: true
        })
      }
    })

    let receivedError = null
    try {
      await askAi(
        {
          systemPrompt: 'system',
          userPrompt: 'user'
        },
        {
          profile: 'ollama-empty'
        }
      )
    } catch (error) {
      receivedError = error
    }

    assert.ok(receivedError)
    assert.equal(receivedError.code, 'AI_EMPTY_RESPONSE')
    assert.equal(receivedError.meta.profile, 'ollama-empty')
    assert.equal(receivedError.meta.status, 200)
    assert.ok(receivedError.meta.rawResponse.includes('"done":true'))
  } finally {
    global.fetch = originalFetch
    delete process.env.ICODE_CONFIG_PATH
  }
})

test('ai-client supports dumpResponse option', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ai-client-test-'))
  process.env.ICODE_CONFIG_PATH = path.join(tempRoot, 'config.json')
  process.env.ICODE_NO_SPINNER = '1'

  const originalFetch = global.fetch
  const originalStderrWrite = process.stderr.write.bind(process.stderr)

  let stderrText = ''
  process.stderr.write = (chunk, encoding, callback) => {
    stderrText += String(chunk)
    if (typeof encoding === 'function') {
      encoding()
    } else if (typeof callback === 'function') {
      callback()
    }
    return true
  }

  try {
    upsertAiProfile('ollama-dump', {
      provider: 'ollama',
      format: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'glm-5:cloud'
    })
    useAiProfile('ollama-dump')

    global.fetch = async () => ({
      ok: true,
      status: 200,
      headers: {
        forEach(callback) {
          callback('application/json', 'content-type')
        }
      },
      async text() {
        return JSON.stringify({
          message: {
            content: 'ok'
          }
        })
      }
    })

    const result = await askAi(
      {
        systemPrompt: 'system',
        userPrompt: 'user'
      },
      {
        profile: 'ollama-dump',
        dumpResponse: true
      }
    )

    assert.equal(result, 'ok')
    assert.ok(stderrText.includes('AI 原始响应'))
    assert.ok(stderrText.includes('"profile": "ollama-dump"'))
    assert.ok(stderrText.includes('"status": 200'))
  } finally {
    process.stderr.write = originalStderrWrite
    global.fetch = originalFetch
    delete process.env.ICODE_NO_SPINNER
    delete process.env.ICODE_CONFIG_PATH
  }
})

test('ai-client openai profile can set requestBody for thinking and stream', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ai-client-test-'))
  process.env.ICODE_CONFIG_PATH = path.join(tempRoot, 'config.json')

  const originalFetch = global.fetch

  try {
    upsertAiProfile('zhipu-openai', {
      provider: 'zhipu',
      format: 'openai',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'test-key',
      model: 'glm-5',
      requestBody: {
        thinking: {
          type: 'disabled'
        },
        stream: false
      }
    })
    useAiProfile('zhipu-openai')

    let captured = null
    global.fetch = async (url, options = {}) => {
      captured = {
        url,
        options
      }
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
                  content: 'ok'
                }
              }
            ]
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
        profile: 'zhipu-openai'
      }
    )

    assert.equal(result, 'ok')
    assert.equal(captured.url, 'https://open.bigmodel.cn/api/paas/v4/chat/completions')
    const requestBody = JSON.parse(captured.options.body)
    assert.equal(requestBody.stream, false)
    assert.deepEqual(requestBody.thinking, {
      type: 'disabled'
    })
  } finally {
    global.fetch = originalFetch
    delete process.env.ICODE_CONFIG_PATH
  }
})

test('ai-client openai empty content should fallback to thinking text', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ai-client-test-'))
  process.env.ICODE_CONFIG_PATH = path.join(tempRoot, 'config.json')

  const originalFetch = global.fetch

  try {
    upsertAiProfile('zhipu-thinking', {
      provider: 'zhipu',
      format: 'openai',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'test-key',
      model: 'glm-5'
    })
    useAiProfile('zhipu-thinking')

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
                content: '',
                reasoning_content: 'this is model thinking'
              }
            }
          ]
        })
      }
    })

    const result = await askAi(
      {
        systemPrompt: 'system',
        userPrompt: 'user'
      },
      {
        profile: 'zhipu-thinking'
      }
    )

    assert.equal(result, 'this is model thinking')
  } finally {
    global.fetch = originalFetch
    delete process.env.ICODE_CONFIG_PATH
  }
})

test('ai-client ollama requestBody can disable think without overriding options', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ai-client-test-'))
  process.env.ICODE_CONFIG_PATH = path.join(tempRoot, 'config.json')

  const originalFetch = global.fetch

  try {
    upsertAiProfile('ollama-think-off', {
      provider: 'ollama',
      format: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'glm-5:cloud',
      requestBody: {
        think: false
      }
    })
    useAiProfile('ollama-think-off')

    let captured = null
    global.fetch = async (url, options = {}) => {
      captured = {
        url,
        options
      }
      return {
        ok: true,
        status: 200,
        headers: {
          forEach() {}
        },
        async text() {
          return JSON.stringify({
            message: {
              content: 'final answer'
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
        profile: 'ollama-think-off'
      }
    )

    assert.equal(result, 'final answer')
    assert.equal(captured.url, 'http://127.0.0.1:11434/api/chat')
    const requestBody = JSON.parse(captured.options.body)
    assert.equal(requestBody.think, false)
    assert.equal(requestBody.options.num_predict, 1200)
  } finally {
    global.fetch = originalFetch
    delete process.env.ICODE_CONFIG_PATH
  }
})

test('ai-client returns thinking when ollama content is empty but thinking exists', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ai-client-test-'))
  process.env.ICODE_CONFIG_PATH = path.join(tempRoot, 'config.json')

  const originalFetch = global.fetch

  try {
    upsertAiProfile('ollama-thinking-only', {
      provider: 'ollama',
      format: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'glm-5:cloud'
    })
    useAiProfile('ollama-thinking-only')

    global.fetch = async () => ({
      ok: true,
      status: 200,
      headers: {
        forEach() {}
      },
      async text() {
        return JSON.stringify({
          message: {
            role: 'assistant',
            content: '',
            thinking: 'thinking-as-fallback'
          },
          done: true
        })
      }
    })

    const result = await askAi(
      {
        systemPrompt: 'system',
        userPrompt: 'user'
      },
      {
        profile: 'ollama-thinking-only'
      }
    )

    assert.equal(result, 'thinking-as-fallback')
  } finally {
    global.fetch = originalFetch
    delete process.env.ICODE_CONFIG_PATH
  }
})

test('ai-client supports openai stream response with thinking enabled', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ai-client-test-'))
  process.env.ICODE_CONFIG_PATH = path.join(tempRoot, 'config.json')

  const originalFetch = global.fetch

  try {
    upsertAiProfile('openai-stream', {
      provider: 'zhipu',
      format: 'openai',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'test-key',
      model: 'glm-5',
      requestBody: {
        thinking: {
          type: 'enabled'
        },
        stream: true
      }
    })
    useAiProfile('openai-stream')

    let captured = null
    global.fetch = async (url, options = {}) => {
      captured = {
        url,
        options
      }
      return {
        ok: true,
        status: 200,
        headers: {
          forEach() {}
        },
        async text() {
          return [
            'data: {"choices":[{"delta":{"reasoning_content":"分析"}}]}',
            'data: {"choices":[{"delta":{"content":"评审"}}]}',
            'data: {"choices":[{"delta":{"content":"结果"}}]}',
            'data: [DONE]'
          ].join('\n')
        }
      }
    }

    const result = await askAi(
      {
        systemPrompt: 'system',
        userPrompt: 'user'
      },
      {
        profile: 'openai-stream'
      }
    )

    const requestBody = JSON.parse(captured.options.body)
    assert.equal(requestBody.stream, true)
    assert.deepEqual(requestBody.thinking, { type: 'enabled' })
    assert.equal(result, '评审结果')
    assert.equal(captured.url, 'https://open.bigmodel.cn/api/paas/v4/chat/completions')
  } finally {
    global.fetch = originalFetch
    delete process.env.ICODE_CONFIG_PATH
  }
})

test('ai-client supports ollama stream response payload', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ai-client-test-'))
  process.env.ICODE_CONFIG_PATH = path.join(tempRoot, 'config.json')

  const originalFetch = global.fetch

  try {
    upsertAiProfile('ollama-stream', {
      provider: 'ollama',
      format: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'glm-5:cloud',
      requestBody: {
        stream: true
      }
    })
    useAiProfile('ollama-stream')

    global.fetch = async () => ({
      ok: true,
      status: 200,
      headers: {
        forEach() {}
      },
      async text() {
        return [
          '{"message":{"content":"评审","thinking":"分"}}',
          '{"message":{"content":"通过","thinking":"析"}}',
          '{"done":true}'
        ].join('\n')
      }
    })

    const result = await askAi(
      {
        systemPrompt: 'system',
        userPrompt: 'user'
      },
      {
        profile: 'ollama-stream'
      }
    )

    assert.equal(result, '评审通过')
  } finally {
    global.fetch = originalFetch
    delete process.env.ICODE_CONFIG_PATH
  }
})
