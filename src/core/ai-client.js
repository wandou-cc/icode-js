import { IcodeError } from './errors.js'
import { getAiProfile } from './ai-config.js'
import { withSpinner } from './loading.js'

function trimSlash(value) {
  return value.replace(/\/+$/, '')
}

function isTruthy(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized)
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function mergeRequestBody(baseBody, extraBody) {
  const base = isPlainObject(baseBody) ? baseBody : {}
  const extra = isPlainObject(extraBody) ? extraBody : {}
  const merged = {
    ...base,
    ...extra
  }

  // Keep nested options merged so profile.requestBody can tweak a field without wiping defaults.
  if (isPlainObject(base.options) || isPlainObject(extra.options)) {
    merged.options = {
      ...(isPlainObject(base.options) ? base.options : {}),
      ...(isPlainObject(extra.options) ? extra.options : {})
    }
  }

  return merged
}

function shouldDumpResponse(options = {}) {
  if (typeof options.dumpResponse === 'boolean') {
    return options.dumpResponse
  }

  return isTruthy(process.env.ICODE_AI_DUMP_RESPONSE)
}

function allowThinkingFallback(options = {}) {
  return options.allowThinkingFallback === true
}

function serializeHeaders(headers) {
  const next = {}
  if (!headers) {
    return next
  }

  if (typeof headers.forEach === 'function') {
    headers.forEach((value, key) => {
      next[String(key)] = String(value)
    })
    return next
  }

  if (Array.isArray(headers)) {
    headers.forEach(([key, value]) => {
      if (key != null && value != null) {
        next[String(key)] = String(value)
      }
    })
    return next
  }

  if (typeof headers === 'object') {
    return normalizeHeaders(headers)
  }

  return next
}

function printResponseDump(meta) {
  const payload = {
    profile: meta.profile,
    format: meta.format,
    endpoint: meta.endpoint,
    status: meta.status,
    headers: meta.responseHeaders || {},
    body: meta.responseText
  }
  process.stderr.write(`[icode] AI 原始响应:\n${JSON.stringify(payload, null, 2)}\n`)
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

  if (baseUrl.endsWith('/responses')) {
    return baseUrl
  }

  if (baseUrl.endsWith('/chat/completions')) {
    return baseUrl
  }

  return `${baseUrl}/chat/completions`
}

function buildOpenAIResponsesEndpoint(profile) {
  const baseUrl = trimSlash(profile.baseUrl || '')

  if (!baseUrl) {
    throw new IcodeError(`AI profile ${profile.name} 缺少 baseUrl`, {
      code: 'AI_BASE_URL_EMPTY',
      exitCode: 2
    })
  }

  if (baseUrl.endsWith('/responses')) {
    return baseUrl
  }

  if (baseUrl.endsWith('/chat/completions')) {
    return `${baseUrl.slice(0, -'/chat/completions'.length)}/responses`
  }

  return `${baseUrl}/responses`
}

function isOpenAIResponsesEndpoint(endpoint = '') {
  return endpoint.endsWith('/responses')
}

function parseContentArray(content) {
  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map((item) => {
      if (typeof item === 'string') {
        return item
      }

      if (item && typeof item === 'object') {
        if (typeof item.text === 'string') {
          return item.text
        }
        if (typeof item.content === 'string') {
          return item.content
        }
      }

      return ''
    })
    .join('\n')
    .trim()
}

function parseOpenAIContent(payload) {
  const content = payload?.choices?.[0]?.message?.content
  if (Array.isArray(content)) {
    return parseContentArray(content)
  }

  return (content || '').trim()
}

function parseOpenAIResponsesContent(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim()
  }

  const output = Array.isArray(payload?.output) ? payload.output : []
  const parts = []

  output.forEach((item) => {
    const content = Array.isArray(item?.content) ? item.content : []
    content.forEach((contentItem) => {
      if (contentItem?.type === 'output_text' && typeof contentItem.text === 'string' && contentItem.text.trim()) {
        parts.push(contentItem.text.trim())
      }
    })
  })

  return parts.join('\n').trim()
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
  const openAiCompatible = parseOpenAIContent(payload)
  if (openAiCompatible) {
    return openAiCompatible
  }

  const messageContent = payload?.message?.content
  if (typeof messageContent === 'string') {
    return messageContent.trim()
  }
  if (Array.isArray(messageContent)) {
    return parseContentArray(messageContent)
  }

  const responseContent = payload?.response
  if (typeof responseContent === 'string') {
    return responseContent.trim()
  }

  const outputContent = payload?.output?.text || payload?.output_text || payload?.output?.content
  if (typeof outputContent === 'string' && outputContent.trim()) {
    return outputContent.trim()
  }
  if (Array.isArray(outputContent)) {
    const parsed = parseContentArray(outputContent)
    if (parsed) {
      return parsed
    }
  }

  const nestedMessageContent = payload?.data?.choices?.[0]?.message?.content
  if (typeof nestedMessageContent === 'string') {
    return nestedMessageContent.trim()
  }
  if (Array.isArray(nestedMessageContent)) {
    const parsed = parseContentArray(nestedMessageContent)
    if (parsed) {
      return parsed
    }
  }

  const plainContent = payload?.content
  if (typeof plainContent === 'string' && plainContent.trim()) {
    return plainContent.trim()
  }
  if (Array.isArray(plainContent)) {
    const parsed = parseContentArray(plainContent)
    if (parsed) {
      return parsed
    }
  }

  if (typeof payload?.result === 'string' && payload.result.trim()) {
    return payload.result.trim()
  }
  if (typeof payload?.message === 'string' && payload.message.trim()) {
    return payload.message.trim()
  }

  return ''
}

function parseOpenAIThinking(payload) {
  const message = payload?.choices?.[0]?.message
  if (!message) {
    return ''
  }

  const candidates = [
    message.reasoning_content,
    message.reasoning,
    message.thinking
  ]

  for (const item of candidates) {
    if (typeof item === 'string' && item.trim()) {
      return item.trim()
    }
    if (Array.isArray(item)) {
      const parsed = parseContentArray(item)
      if (parsed) {
        return parsed
      }
    }
  }

  return ''
}

function parseOpenAIResponsesThinking(payload) {
  const summaryList = Array.isArray(payload?.reasoning?.summary) ? payload.reasoning.summary : []
  return summaryList
    .map((item) => {
      if (typeof item === 'string') {
        return item
      }
      if (typeof item?.text === 'string') {
        return item.text
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}

function parseOllamaThinking(payload) {
  const message = payload?.message
  if (message && typeof message === 'object') {
    const candidates = [
      message.thinking,
      message.reasoning_content,
      message.reasoning
    ]

    for (const item of candidates) {
      if (typeof item === 'string' && item.trim()) {
        return item.trim()
      }
      if (Array.isArray(item)) {
        const parsed = parseContentArray(item)
        if (parsed) {
          return parsed
        }
      }
    }
  }

  const payloadCandidates = [
    payload?.thinking,
    payload?.reasoning_content,
    payload?.reasoning
  ]
  for (const item of payloadCandidates) {
    if (typeof item === 'string' && item.trim()) {
      return item.trim()
    }
    if (Array.isArray(item)) {
      const parsed = parseContentArray(item)
      if (parsed) {
        return parsed
      }
    }
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

function parseOpenAIStreamContent(rawText) {
  const contentParts = []
  const thinkingParts = []
  let payloadCount = 0

  const lines = String(rawText || '').split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line.startsWith('data:')) {
      continue
    }

    const payloadText = line.slice(5).trim()
    if (!payloadText || payloadText === '[DONE]') {
      continue
    }

    let payload = null
    try {
      payload = JSON.parse(payloadText)
    } catch {
      continue
    }

    payloadCount += 1
    const delta = payload?.choices?.[0]?.delta
    if (!delta) {
      continue
    }

    if (typeof delta.content === 'string') {
      contentParts.push(delta.content)
    } else if (Array.isArray(delta.content)) {
      const parsed = parseContentArray(delta.content)
      if (parsed) {
        contentParts.push(parsed)
      }
    }

    const thinkingCandidate = delta.reasoning_content || delta.reasoning || delta.thinking
    if (typeof thinkingCandidate === 'string') {
      thinkingParts.push(thinkingCandidate)
    } else if (Array.isArray(thinkingCandidate)) {
      const parsed = parseContentArray(thinkingCandidate)
      if (parsed) {
        thinkingParts.push(parsed)
      }
    }
  }

  return {
    payloadCount,
    content: contentParts.join('').trim(),
    thinking: thinkingParts.join('').trim()
  }
}

function buildStreamPartKey(payload, indexField = 'content_index') {
  const outputIndex = Number.isInteger(payload?.output_index) ? payload.output_index : 0
  const partIndex = Number.isInteger(payload?.[indexField]) ? payload[indexField] : 0
  return `${outputIndex}:${partIndex}`
}

function setStreamPart(parts, key, value, append = false) {
  if (typeof value !== 'string' || !value) {
    return
  }

  const current = parts.get(key) || ''
  parts.set(key, append ? `${current}${value}` : value)
}

function joinStreamParts(parts) {
  return [...parts.entries()]
    .sort(([leftKey], [rightKey]) => {
      const [leftOutput = 0, leftPart = 0] = leftKey.split(':').map((item) => Number(item) || 0)
      const [rightOutput = 0, rightPart = 0] = rightKey.split(':').map((item) => Number(item) || 0)
      if (leftOutput !== rightOutput) {
        return leftOutput - rightOutput
      }
      return leftPart - rightPart
    })
    .map(([, value]) => value.trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

function parseOpenAIResponsesStreamContent(rawText) {
  const contentParts = new Map()
  const thinkingParts = new Map()
  let payloadCount = 0
  let completedResponse = null

  const lines = String(rawText || '').split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line.startsWith('data:')) {
      continue
    }

    const payloadText = line.slice(5).trim()
    if (!payloadText) {
      continue
    }

    let payload = null
    try {
      payload = JSON.parse(payloadText)
    } catch {
      continue
    }

    payloadCount += 1

    if (payload?.type === 'response.completed' && payload?.response && typeof payload.response === 'object') {
      completedResponse = payload.response
      continue
    }

    if (payload?.type === 'response.output_text.delta') {
      setStreamPart(contentParts, buildStreamPartKey(payload), payload.delta, true)
      continue
    }

    if (payload?.type === 'response.output_text.done') {
      setStreamPart(contentParts, buildStreamPartKey(payload), payload.text)
      continue
    }

    if (payload?.type === 'response.reasoning_summary_text.delta') {
      setStreamPart(thinkingParts, buildStreamPartKey(payload, 'summary_index'), payload.delta, true)
      continue
    }

    if (payload?.type === 'response.reasoning_summary_text.done') {
      setStreamPart(thinkingParts, buildStreamPartKey(payload, 'summary_index'), payload.text)
      continue
    }

    if (payload?.type === 'response.reasoning_text.delta') {
      setStreamPart(thinkingParts, buildStreamPartKey(payload), payload.delta, true)
      continue
    }

    if (payload?.type === 'response.reasoning_text.done') {
      setStreamPart(thinkingParts, buildStreamPartKey(payload), payload.text)
      continue
    }

    if (payload?.type === 'response.content_part.done') {
      const part = payload.part
      if (part?.type === 'output_text') {
        setStreamPart(contentParts, buildStreamPartKey(payload), part.text)
        continue
      }

      if (part?.type === 'reasoning_text') {
        setStreamPart(thinkingParts, buildStreamPartKey(payload), part.text)
      }
    }
  }

  let content = joinStreamParts(contentParts)
  let thinking = joinStreamParts(thinkingParts)

  if (completedResponse) {
    if (!content) {
      content = parseOpenAIResponsesContent(completedResponse)
    }
    if (!thinking) {
      thinking = parseOpenAIResponsesThinking(completedResponse)
    }
  }

  return {
    payloadCount,
    content,
    thinking
  }
}

function parseOllamaStreamContent(rawText) {
  const contentParts = []
  const thinkingParts = []
  let payloadCount = 0

  const lines = String(rawText || '').split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }

    let payload = null
    try {
      payload = JSON.parse(line)
    } catch {
      continue
    }

    payloadCount += 1

    const content = parseOllamaContent(payload)
    if (content) {
      contentParts.push(content)
    }

    const thinking = parseOllamaThinking(payload)
    if (thinking) {
      thinkingParts.push(thinking)
    }
  }

  return {
    payloadCount,
    content: contentParts.join('').trim(),
    thinking: thinkingParts.join('').trim()
  }
}

function parseResponseJson(text, meta) {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new IcodeError(`AI 响应解析失败: ${error.message}`, {
      code: 'AI_RESPONSE_JSON_PARSE_ERROR',
      exitCode: 2,
      meta: {
        ...meta,
        rawResponse: text
      }
    })
  }
}

function buildThinkingOnlyError(message, meta, thinkingContent = '', hint = '') {
  return new IcodeError(message, {
    code: 'AI_EMPTY_RESPONSE',
    exitCode: 2,
    meta: {
      ...meta,
      thinkingPreview: thinkingContent.slice(0, 400),
      hint
    }
  })
}

function shouldRetryWithResponsesApi(error) {
  if (!error || error.code !== 'AI_HTTP_ERROR') {
    return false
  }

  const rawResponse = String(error.meta?.rawResponse || '')
  return rawResponse.includes('Unsupported legacy protocol') && rawResponse.includes('/v1/responses')
}

function buildOpenAIChatRequestBody(profile, prompt) {
  return mergeRequestBody({
    model: profile.model,
    stream: false,
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
  }, profile.requestBody)
}

function buildOpenAIResponsesRequestBody(profile, prompt) {
  return mergeRequestBody({
    model: profile.model,
    stream: false,
    temperature: profile.temperature,
    max_output_tokens: profile.maxTokens,
    instructions: prompt.systemPrompt,
    input: prompt.userPrompt
  }, profile.requestBody)
}

async function performJsonRequest({ endpoint, profile, headers, requestBody, options }) {
  return withSpinner(`等待响应`, async () => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    })

    const responseText = await response.text()
    const responseHeaders = serializeHeaders(response.headers)
    if (shouldDumpResponse(options)) {
      printResponseDump({
        profile: profile.name,
        format: profile.format,
        endpoint,
        status: response.status,
        responseHeaders,
        responseText
      })
    }

    if (!response.ok) {
      throw new IcodeError(`AI 请求失败(${response.status}): ${responseText}`, {
        code: 'AI_HTTP_ERROR',
        exitCode: 2,
        meta: {
          status: response.status,
          endpoint,
          profile: profile.name,
          format: profile.format,
          responseHeaders,
          rawResponse: responseText
        }
      })
    }

    return {
      status: response.status,
      responseHeaders,
      text: responseText
    }
  })
}

function parseOpenAIPayload(responseMeta, profile, endpoint) {
  return parseResponseJson(responseMeta.text, {
    status: responseMeta.status,
    endpoint,
    profile: profile.name,
    format: profile.format,
    responseHeaders: responseMeta.responseHeaders
  })
}

function resolveOpenAITextFromPayload(payload, responseMeta, profile, endpoint, options) {
  const parsedContent = isOpenAIResponsesEndpoint(endpoint)
    ? parseOpenAIResponsesContent(payload)
    : parseOpenAIContent(payload)
  if (parsedContent) {
    return parsedContent
  }

  const thinkingContent = isOpenAIResponsesEndpoint(endpoint)
    ? parseOpenAIResponsesThinking(payload)
    : parseOpenAIThinking(payload)
  if (thinkingContent && allowThinkingFallback(options)) {
    return thinkingContent
  }

  throw buildThinkingOnlyError(
    'AI 返回正文为空。当前响应可能只有思考过程，默认不会把 reasoning/thinking 当成最终内容输出。',
    {
      endpoint,
      profile: profile.name,
      status: responseMeta.status,
      responseHeaders: responseMeta.responseHeaders,
      rawResponse: responseMeta.text
    },
    thinkingContent,
    isOpenAIResponsesEndpoint(endpoint)
      ? '可在 profile.requestBody 中设置 {"reasoning":{"summary":"none"},"stream":false}，或切换支持文本输出的模型。'
      : '可在 profile.requestBody 中设置 {"thinking":{"type":"disabled"},"stream":false}，或切换不带思考输出的模型。'
  )
}

async function requestOpenAI(profile, prompt, options = {}) {
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
  let resolvedEndpoint = endpoint
  let requestBody = isOpenAIResponsesEndpoint(resolvedEndpoint)
    ? buildOpenAIResponsesRequestBody(profile, prompt)
    : buildOpenAIChatRequestBody(profile, prompt)
  let responseMeta = null

  try {
    responseMeta = await performJsonRequest({
      endpoint: resolvedEndpoint,
      profile,
      headers,
      requestBody,
      options
    })
  } catch (error) {
    if (!isOpenAIResponsesEndpoint(resolvedEndpoint) && shouldRetryWithResponsesApi(error)) {
      resolvedEndpoint = buildOpenAIResponsesEndpoint(profile)
      requestBody = buildOpenAIResponsesRequestBody(profile, prompt)
      responseMeta = await performJsonRequest({
        endpoint: resolvedEndpoint,
        profile,
        headers,
        requestBody,
        options
      })
    } else {
      throw error
    }
  }

  if (requestBody.stream === true) {
    const streamResult = isOpenAIResponsesEndpoint(resolvedEndpoint)
      ? parseOpenAIResponsesStreamContent(responseMeta.text)
      : parseOpenAIStreamContent(responseMeta.text)
    if (streamResult.payloadCount > 0) {
      if (streamResult.content) {
        return streamResult.content
      }
      if (streamResult.thinking && allowThinkingFallback(options)) {
        return streamResult.thinking
      }

      throw buildThinkingOnlyError(
        'AI 返回正文为空，检测到 reasoning/thinking。为避免暴露思考过程，默认不会把它当成最终内容输出。',
        {
          endpoint: resolvedEndpoint,
          profile: profile.name,
          status: responseMeta.status,
          responseHeaders: responseMeta.responseHeaders,
          rawResponse: responseMeta.text
        },
        streamResult.thinking,
        isOpenAIResponsesEndpoint(resolvedEndpoint)
          ? '可在 profile.requestBody 中设置 {"reasoning":{"summary":"none"},"stream":false} 后重试。'
          : '可在 profile.requestBody 中设置 {"thinking":{"type":"disabled"},"stream":false} 后重试。'
      )
    }
  }

  const payload = parseOpenAIPayload(responseMeta, profile, resolvedEndpoint)
  return resolveOpenAITextFromPayload(payload, responseMeta, profile, resolvedEndpoint, options)
}

async function requestAnthropic(profile, prompt, options = {}) {
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
  const requestBody = mergeRequestBody({
    model: profile.model,
    system: prompt.systemPrompt,
    stream: false,
    max_tokens: profile.maxTokens,
    temperature: profile.temperature,
    messages: [
      {
        role: 'user',
        content: prompt.userPrompt
      }
    ]
  }, profile.requestBody)

  const responseMeta = await withSpinner(`等待响应`, async () => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    })

    const responseText = await response.text()
    const responseHeaders = serializeHeaders(response.headers)
    if (shouldDumpResponse(options)) {
      printResponseDump({
        profile: profile.name,
        format: profile.format,
        endpoint,
        status: response.status,
        responseHeaders,
        responseText
      })
    }

    if (!response.ok) {
      throw new IcodeError(`AI 请求失败(${response.status}): ${responseText}`, {
        code: 'AI_HTTP_ERROR',
        exitCode: 2,
        meta: {
          status: response.status,
          endpoint,
          profile: profile.name,
          format: profile.format,
          responseHeaders,
          rawResponse: responseText
        }
      })
    }

    return {
      status: response.status,
      responseHeaders,
      text: responseText
    }
  })

  const payload = parseResponseJson(responseMeta.text, {
    status: responseMeta.status,
    endpoint,
    profile: profile.name,
    format: profile.format,
    responseHeaders: responseMeta.responseHeaders
  })
  const parsedContent = parseAnthropicContent(payload)
  if (parsedContent) {
    return parsedContent
  }

  throw new IcodeError('Anthropic 返回内容为空，请检查模型可用性或调整请求参数后重试。', {
    code: 'AI_EMPTY_RESPONSE',
    exitCode: 2,
    meta: {
      endpoint,
      profile: profile.name,
      status: responseMeta.status,
      responseHeaders: responseMeta.responseHeaders,
      rawResponse: responseMeta.text
    }
  })
}

async function requestOllama(profile, prompt, options = {}) {
  const endpoint = buildEndpoint(profile)
  const customHeaders = normalizeHeaders(profile.headers)
  const headers = {
    'Content-Type': 'application/json',
    ...customHeaders
  }
  const apiKey = resolveApiKey(profile)

  // Ollama local deployments usually do not need auth; gateways can still use Bearer.
  if (apiKey && !Object.keys(headers).some((key) => key.toLowerCase() === 'authorization')) {
    headers.Authorization = `Bearer ${apiKey}`
  }
  const requestBody = mergeRequestBody({
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
  }, profile.requestBody)

  const responseMeta = await withSpinner(`等待响应`, async () => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    })

    const responseText = await response.text()
    const responseHeaders = serializeHeaders(response.headers)
    if (shouldDumpResponse(options)) {
      printResponseDump({
        profile: profile.name,
        format: profile.format,
        endpoint,
        status: response.status,
        responseHeaders,
        responseText
      })
    }

    if (!response.ok) {
      throw new IcodeError(`AI 请求失败(${response.status}): ${responseText}`, {
        code: 'AI_HTTP_ERROR',
        exitCode: 2,
        meta: {
          status: response.status,
          endpoint,
          profile: profile.name,
          format: profile.format,
          responseHeaders,
          rawResponse: responseText
        }
      })
    }

    return {
      status: response.status,
      responseHeaders,
      text: responseText
    }
  })

  if (requestBody.stream === true) {
    const streamResult = parseOllamaStreamContent(responseMeta.text)
    if (streamResult.payloadCount > 0) {
      if (streamResult.content) {
        return streamResult.content
      }
      if (streamResult.thinking && allowThinkingFallback(options)) {
        return streamResult.thinking
      }

      throw buildThinkingOnlyError(
        'AI 返回正文为空，检测到 thinking/reasoning。为避免暴露思考过程，默认不会把它当成最终内容输出。',
        {
          endpoint,
          profile: profile.name,
          status: responseMeta.status,
          responseHeaders: responseMeta.responseHeaders,
          rawResponse: responseMeta.text
        },
        streamResult.thinking,
        '可在 profile.requestBody 中设置 {"think":false,"stream":false} 后重试。'
      )
    }
  }

  const payload = parseResponseJson(responseMeta.text, {
    status: responseMeta.status,
    endpoint,
    profile: profile.name,
    format: profile.format,
    responseHeaders: responseMeta.responseHeaders
  })
  const parsedContent = parseOllamaContent(payload)
  if (parsedContent) {
    return parsedContent
  }

  const thinkingContent = parseOllamaThinking(payload)
  if (thinkingContent && allowThinkingFallback(options)) {
    return thinkingContent
  }

  throw buildThinkingOnlyError(
    'Ollama 返回正文为空。当前响应可能只有思考过程，默认不会把 thinking/reasoning 当成最终内容输出。',
    {
      endpoint,
      profile: profile.name,
      status: responseMeta.status,
      responseHeaders: responseMeta.responseHeaders,
      payloadKeys: Object.keys(payload || {}),
      doneReason: payload?.done_reason || payload?.choices?.[0]?.finish_reason || '',
      rawResponse: responseMeta.text
    },
    thinkingContent,
    '若模型仅返回思考内容，可在 profile.requestBody 中设置 {"think":false,"stream":false}，或切换不带思考的模型。'
  )
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
    return requestAnthropic(profile, prompt, options)
  }

  if (profile.format === 'ollama') {
    return requestOllama(profile, prompt, options)
  }

  return requestOpenAI(profile, prompt, options)
}

export async function askAiJson(prompt, options = {}) {
  const text = await askAi(prompt, {
    ...options,
    allowThinkingFallback: options.allowThinkingFallback !== false
  })
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
