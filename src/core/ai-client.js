import { IcodeError } from './errors.js'
import { getAiProfile } from './ai-config.js'
import { withSpinner } from './loading.js'

function trimSlash(value) {
  return value.replace(/\/+$/, '')
}

function normalizeHeaders(headers = {}) {
  const next = {}
  Object.entries(headers).forEach(([key, value]) => {
    if (value == null) {
      return
    }
    next[String(key)] = String(value)
  })
  return next
}

function resolveApiKey(profile) {
  if (profile.apiKey) {
    return profile.apiKey
  }

  if (profile.format === 'anthropic') {
    return process.env.ANTHROPIC_API_KEY || process.env.ICODE_AI_API_KEY || ''
  }

  if (profile.format === 'ollama') {
    return process.env.OLLAMA_API_KEY || ''
  }

  return process.env.OPENAI_API_KEY || process.env.ICODE_AI_API_KEY || ''
}

function buildEndpoint(profile) {
  const configuredBaseUrl = trimSlash(profile.baseUrl || '')
  const fallbackBaseUrl = profile.format === 'ollama'
    ? trimSlash(process.env.OLLAMA_HOST || 'http://127.0.0.1:11434')
    : ''
  const baseUrl = configuredBaseUrl || fallbackBaseUrl

  if (!baseUrl) {
    throw new IcodeError(`AI profile ${profile.name} 缺少 baseUrl`, {
      code: 'AI_BASE_URL_EMPTY',
      exitCode: 2
    })
  }

  if (profile.format === 'anthropic') {
    if (baseUrl.endsWith('/messages')) {
      return baseUrl
    }
    return `${baseUrl}/messages`
  }

  if (profile.format === 'ollama') {
    if (baseUrl.endsWith('/api/chat')) {
      return baseUrl
    }
    return `${baseUrl}/api/chat`
  }

  if (baseUrl.endsWith('/chat/completions')) {
    return baseUrl
  }

  return `${baseUrl}/chat/completions`
}

function parseOpenAIContent(payload) {
  const content = payload?.choices?.[0]?.message?.content
  if (Array.isArray(content)) {
    return content
      .map((item) => item?.text || '')
      .join('\n')
      .trim()
  }

  return (content || '').trim()
}

function parseAnthropicContent(payload) {
  const content = payload?.content
  if (Array.isArray(content)) {
    return content
      .map((item) => item?.text || '')
      .join('\n')
      .trim()
  }

  return ''
}

function parseOllamaContent(payload) {
  const messageContent = payload?.message?.content
  if (typeof messageContent === 'string') {
    return messageContent.trim()
  }

  const responseContent = payload?.response
  if (typeof responseContent === 'string') {
    return responseContent.trim()
  }

  return ''
}

function parseJsonWithFallback(rawText) {
  const text = (rawText || '').trim()
  if (!text) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    // 兜底解析: 尝试提取第一段 JSON 块。
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) {
      return null
    }

    try {
      return JSON.parse(match[0])
    } catch {
      return null
    }
  }
}

async function requestOpenAI(profile, prompt) {
  const apiKey = resolveApiKey(profile)
  if (!apiKey) {
    throw new IcodeError(`AI profile ${profile.name} 缺少 apiKey（可通过配置或环境变量设置）`, {
      code: 'AI_API_KEY_EMPTY',
      exitCode: 2
    })
  }

  const endpoint = buildEndpoint(profile)
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    ...normalizeHeaders(profile.headers)
  }

  const text = await withSpinner(`等待 AI(${profile.name}) 响应`, async () => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: profile.model,
        temperature: profile.temperature,
        max_tokens: profile.maxTokens,
        messages: [
          {
            role: 'system',
            content: prompt.systemPrompt
          },
          {
            role: 'user',
            content: prompt.userPrompt
          }
        ]
      })
    })

    const responseText = await response.text()
    if (!response.ok) {
      throw new IcodeError(`AI 请求失败(${response.status}): ${responseText}`, {
        code: 'AI_HTTP_ERROR',
        exitCode: 2,
        meta: {
          status: response.status,
          endpoint
        }
      })
    }

    return responseText
  })

  const payload = JSON.parse(text)
  return parseOpenAIContent(payload)
}

async function requestAnthropic(profile, prompt) {
  const apiKey = resolveApiKey(profile)
  if (!apiKey) {
    throw new IcodeError(`AI profile ${profile.name} 缺少 apiKey（可通过配置或环境变量设置）`, {
      code: 'AI_API_KEY_EMPTY',
      exitCode: 2
    })
  }

  const endpoint = buildEndpoint(profile)
  const customHeaders = normalizeHeaders(profile.headers)
  const anthropicVersion = customHeaders['anthropic-version'] || '2023-06-01'

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': anthropicVersion,
    ...customHeaders
  }

  const text = await withSpinner(`等待 AI(${profile.name}) 响应`, async () => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: profile.model,
        system: prompt.systemPrompt,
        max_tokens: profile.maxTokens,
        temperature: profile.temperature,
        messages: [
          {
            role: 'user',
            content: prompt.userPrompt
          }
        ]
      })
    })

    const responseText = await response.text()
    if (!response.ok) {
      throw new IcodeError(`AI 请求失败(${response.status}): ${responseText}`, {
        code: 'AI_HTTP_ERROR',
        exitCode: 2,
        meta: {
          status: response.status,
          endpoint
        }
      })
    }

    return responseText
  })

  const payload = JSON.parse(text)
  return parseAnthropicContent(payload)
}

async function requestOllama(profile, prompt) {
  const endpoint = buildEndpoint(profile)
  const customHeaders = normalizeHeaders(profile.headers)
  const headers = {
    'Content-Type': 'application/json',
    ...customHeaders
  }
  const apiKey = resolveApiKey(profile)

  // Ollama 本地部署默认不需要鉴权；当挂在网关后可通过 profile.apiKey/环境变量启用 Bearer。
  if (apiKey && !Object.keys(headers).some((key) => key.toLowerCase() === 'authorization')) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  const text = await withSpinner(`等待 AI(${profile.name}) 响应`, async () => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: profile.model,
        stream: false,
        messages: [
          {
            role: 'system',
            content: prompt.systemPrompt
          },
          {
            role: 'user',
            content: prompt.userPrompt
          }
        ],
        options: {
          temperature: profile.temperature,
          num_predict: profile.maxTokens
        }
      })
    })

    const responseText = await response.text()
    if (!response.ok) {
      throw new IcodeError(`AI 请求失败(${response.status}): ${responseText}`, {
        code: 'AI_HTTP_ERROR',
        exitCode: 2,
        meta: {
          status: response.status,
          endpoint
        }
      })
    }

    return responseText
  })

  const payload = JSON.parse(text)
  return parseOllamaContent(payload)
}

export async function askAi(prompt, options = {}) {
  const profile = getAiProfile(options.profile)
  if (!profile.model) {
    throw new IcodeError(`AI profile ${profile.name} 缺少 model`, {
      code: 'AI_MODEL_EMPTY',
      exitCode: 2
    })
  }

  if (profile.format === 'anthropic') {
    return requestAnthropic(profile, prompt)
  }

  if (profile.format === 'ollama') {
    return requestOllama(profile, prompt)
  }

  return requestOpenAI(profile, prompt)
}

export async function askAiJson(prompt, options = {}) {
  const text = await askAi(prompt, options)
  const parsed = parseJsonWithFallback(text)
  if (!parsed) {
    throw new IcodeError('AI 返回结果不是合法 JSON，请调整模型提示词或重试。', {
      code: 'AI_JSON_PARSE_ERROR',
      exitCode: 2,
      meta: {
        text
      }
    })
  }

  return {
    text,
    parsed
  }
}
