import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { askAi, askAiJson } from '../src/core/ai-client.js'
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

test('ai-client supports openai responses endpoint directly', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ai-client-test-'))
  process.env.ICODE_CONFIG_PATH = path.join(tempRoot, 'config.json')

  const originalFetch = global.fetch

  try {
    upsertAiProfile('openai-responses', {
      provider: 'openai',
      format: 'openai',
      baseUrl: 'https://api.openai.com/v1/responses',
      apiKey: 'test-key',
      model: 'gpt-5.4'
    })
    useAiProfile('openai-responses')

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
            output: [
              {
                type: 'message',
                content: [
                  {
                    type: 'output_text',
                    text: 'responses-ok'
                  }
                ]
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
        profile: 'openai-responses'
      }
    )

    assert.equal(result, 'responses-ok')
    assert.equal(captured.url, 'https://api.openai.com/v1/responses')
    const requestBody = JSON.parse(captured.options.body)
    assert.equal(requestBody.instructions, 'system')
    assert.equal(requestBody.input, 'user')
    assert.equal(requestBody.max_output_tokens, 1200)
  } finally {
    global.fetch = originalFetch
    delete process.env.ICODE_CONFIG_PATH
  }
})

test('ai-client supports streamed openai responses endpoint directly', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ai-client-test-'))
  process.env.ICODE_CONFIG_PATH = path.join(tempRoot, 'config.json')

  const originalFetch = global.fetch

  try {
    upsertAiProfile('openai-responses-stream', {
      provider: 'openai',
      format: 'openai',
      baseUrl: 'https://api.openai.com/v1/responses',
      apiKey: 'test-key',
      model: 'gpt-5.4',
      requestBody: {
        stream: true
      }
    })
    useAiProfile('openai-responses-stream')

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
            'data: {"type":"response.reasoning_summary_text.delta","output_index":0,"summary_index":0,"delta":"分析"}',
            'data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"responses"}',
            'data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"-stream"}',
            'data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"responses-stream"}]}]}}'
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
        profile: 'openai-responses-stream'
      }
    )

    assert.equal(result, 'responses-stream')
    assert.equal(captured.url, 'https://api.openai.com/v1/responses')
    const requestBody = JSON.parse(captured.options.body)
    assert.equal(requestBody.stream, true)
    assert.equal(requestBody.instructions, 'system')
    assert.equal(requestBody.input, 'user')
  } finally {
    global.fetch = originalFetch
    delete process.env.ICODE_CONFIG_PATH
  }
})

test('ai-client retries openai requests with responses endpoint when legacy protocol is rejected', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ai-client-test-'))
  process.env.ICODE_CONFIG_PATH = path.join(tempRoot, 'config.json')

  const originalFetch = global.fetch

  try {
    upsertAiProfile('openai-legacy-retry', {
      provider: 'openai',
      format: 'openai',
      baseUrl: 'https://cc.sub.258000.sbs/v1',
      apiKey: 'test-key',
      model: 'gpt-5.4'
    })
    useAiProfile('openai-legacy-retry')

    const urls = []
    global.fetch = async (url, options = {}) => {
      urls.push(url)
      if (url === 'https://cc.sub.258000.sbs/v1/chat/completions') {
        return {
          ok: false,
          status: 400,
          headers: {
            forEach() {}
          },
          async text() {
            return JSON.stringify({
              error: {
                message: 'Unsupported legacy protocol: /v1/chat/completions is not supported. Please use /v1/responses.',
                type: 'invalid_request_error'
              }
            })
          }
        }
      }

      if (url === 'https://cc.sub.258000.sbs/v1/responses') {
        const requestBody = JSON.parse(options.body)
        assert.equal(requestBody.instructions, 'system')
        assert.equal(requestBody.input, 'user')

        return {
          ok: true,
          status: 200,
          headers: {
            forEach() {}
          },
          async text() {
            return JSON.stringify({
              output: [
                {
                  type: 'message',
                  content: [
                    {
                      type: 'output_text',
                      text: 'retry-ok'
                    }
                  ]
                }
              ]
            })
          }
        }
      }

      throw new Error(`unexpected url: ${url}`)
    }

    const result = await askAi(
      {
        systemPrompt: 'system',
        userPrompt: 'user'
      },
      {
        profile: 'openai-legacy-retry'
      }
    )

    assert.equal(result, 'retry-ok')
    assert.deepEqual(urls, [
      'https://cc.sub.258000.sbs/v1/chat/completions',
      'https://cc.sub.258000.sbs/v1/responses'
    ])
  } finally {
    global.fetch = originalFetch
    delete process.env.ICODE_CONFIG_PATH
  }
})

test('ai-client parses streamed responses payload after legacy protocol retry', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ai-client-test-'))
  process.env.ICODE_CONFIG_PATH = path.join(tempRoot, 'config.json')

  const originalFetch = global.fetch

  try {
    upsertAiProfile('openai-legacy-retry-stream', {
      provider: 'openai',
      format: 'openai',
      baseUrl: 'https://cc.sub.258000.sbs/v1',
      apiKey: 'test-key',
      model: 'gpt-5.4',
      requestBody: {
        stream: true
      }
    })
    useAiProfile('openai-legacy-retry-stream')

    const urls = []
    global.fetch = async (url, options = {}) => {
      urls.push(url)
      if (url === 'https://cc.sub.258000.sbs/v1/chat/completions') {
        return {
          ok: false,
          status: 400,
          headers: {
            forEach() {}
          },
          async text() {
            return JSON.stringify({
              error: {
                message: 'Unsupported legacy protocol: /v1/chat/completions is not supported. Please use /v1/responses.',
                type: 'invalid_request_error'
              }
            })
          }
        }
      }

      if (url === 'https://cc.sub.258000.sbs/v1/responses') {
        const requestBody = JSON.parse(options.body)
        assert.equal(requestBody.stream, true)
        assert.equal(requestBody.instructions, 'system')
        assert.equal(requestBody.input, 'user')

        return {
          ok: true,
          status: 200,
          headers: {
            forEach() {}
          },
          async text() {
            return [
              'data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"retry"}',
              'data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"-stream"}'
            ].join('\n')
          }
        }
      }

      throw new Error(`unexpected url: ${url}`)
    }

    const result = await askAi(
      {
        systemPrompt: 'system',
        userPrompt: 'user'
      },
      {
        profile: 'openai-legacy-retry-stream'
      }
    )

    assert.equal(result, 'retry-stream')
    assert.deepEqual(urls, [
      'https://cc.sub.258000.sbs/v1/chat/completions',
      'https://cc.sub.258000.sbs/v1/responses'
    ])
  } finally {
    global.fetch = originalFetch
    delete process.env.ICODE_CONFIG_PATH
  }
})

test('ai-client openai thinking-only response should raise AI_EMPTY_RESPONSE', async () => {
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

    let receivedError = null
    try {
      await askAi(
        {
          systemPrompt: 'system',
          userPrompt: 'user'
        },
        {
          profile: 'zhipu-thinking'
        }
      )
    } catch (error) {
      receivedError = error
    }

    assert.ok(receivedError)
    assert.equal(receivedError.code, 'AI_EMPTY_RESPONSE')
    assert.equal(receivedError.meta.profile, 'zhipu-thinking')
    assert.equal(receivedError.meta.thinkingPreview, 'this is model thinking')
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

test('ai-client ollama thinking-only response should raise AI_EMPTY_RESPONSE', async () => {
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

    let receivedError = null
    try {
      await askAi(
        {
          systemPrompt: 'system',
          userPrompt: 'user'
        },
        {
          profile: 'ollama-thinking-only'
        }
      )
    } catch (error) {
      receivedError = error
    }

    assert.ok(receivedError)
    assert.equal(receivedError.code, 'AI_EMPTY_RESPONSE')
    assert.equal(receivedError.meta.profile, 'ollama-thinking-only')
    assert.equal(receivedError.meta.thinkingPreview, 'thinking-as-fallback')
  } finally {
    global.fetch = originalFetch
    delete process.env.ICODE_CONFIG_PATH
  }
})

test('ai-client askAiJson can still parse JSON from thinking-only response', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-ai-client-test-'))
  process.env.ICODE_CONFIG_PATH = path.join(tempRoot, 'config.json')

  const originalFetch = global.fetch

  try {
    upsertAiProfile('zhipu-json-thinking', {
      provider: 'zhipu',
      format: 'openai',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'test-key',
      model: 'glm-5'
    })
    useAiProfile('zhipu-json-thinking')

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
                reasoning_content: '{"type":"feat","subject":"add AI review flow"}'
              }
            }
          ]
        })
      }
    })

    const result = await askAiJson(
      {
        systemPrompt: 'system',
        userPrompt: 'user'
      },
      {
        profile: 'zhipu-json-thinking'
      }
    )

    assert.equal(result.text, '{"type":"feat","subject":"add AI review flow"}')
    assert.deepEqual(result.parsed, {
      type: 'feat',
      subject: 'add AI review flow'
    })
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
