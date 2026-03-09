import { IcodeError } from './errors.js'
import { readConfig, writeConfig } from './config-store.js'

const DEFAULT_PROFILE = {
  provider: 'custom',
  format: 'openai',
  baseUrl: '',
  apiKey: '',
  model: '',
  temperature: 0.2,
  maxTokens: 1200,
  headers: {}
}

const ALLOWED_OPTION_SCOPES = new Set(['commit', 'conflict', 'codereview', 'push'])

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeFormat(format) {
  const normalized = (format || 'openai').trim().toLowerCase()
  if (!['openai', 'anthropic', 'ollama'].includes(normalized)) {
    throw new IcodeError(`不支持的 AI 接口格式: ${format}`, {
      code: 'AI_FORMAT_INVALID',
      exitCode: 2
    })
  }
  return normalized
}

function ensureAiSection(config) {
  if (!config.ai || typeof config.ai !== 'object') {
    config.ai = {
      activeProfile: '',
      profiles: {}
    }
  }

  if (!config.ai.profiles || typeof config.ai.profiles !== 'object') {
    config.ai.profiles = {}
  }

  if (!config.ai.options || typeof config.ai.options !== 'object' || Array.isArray(config.ai.options)) {
    config.ai.options = {}
  }

  if (typeof config.ai.activeProfile !== 'string') {
    config.ai.activeProfile = ''
  }

  return config
}

function normalizeProfile(profile = {}) {
  const next = {
    ...clone(DEFAULT_PROFILE),
    ...profile,
    provider: (profile.provider || DEFAULT_PROFILE.provider).trim(),
    format: normalizeFormat(profile.format || DEFAULT_PROFILE.format),
    baseUrl: (profile.baseUrl || '').trim(),
    apiKey: (profile.apiKey || '').trim(),
    model: (profile.model || '').trim(),
    temperature: Number.isFinite(Number(profile.temperature)) ? Number(profile.temperature) : DEFAULT_PROFILE.temperature,
    maxTokens: Number.isFinite(Number(profile.maxTokens)) ? Number(profile.maxTokens) : DEFAULT_PROFILE.maxTokens,
    headers: profile.headers && typeof profile.headers === 'object' ? profile.headers : {}
  }

  return next
}

function resolveActiveProfileName(aiConfig) {
  const active = (aiConfig.activeProfile || '').trim()
  if (active && aiConfig.profiles[active]) {
    return active
  }

  const names = Object.keys(aiConfig.profiles)
  return names[0] || ''
}

function maskKey(value) {
  const raw = (value || '').trim()
  if (!raw) {
    return ''
  }

  if (raw.length <= 8) {
    return `${raw.slice(0, 2)}****${raw.slice(-1)}`
  }

  return `${raw.slice(0, 4)}****${raw.slice(-4)}`
}

export function getAiConfig() {
  const config = ensureAiSection(readConfig())
  const activeProfile = resolveActiveProfileName(config.ai)

  if (activeProfile && config.ai.activeProfile !== activeProfile) {
    config.ai.activeProfile = activeProfile
    writeConfig(config)
  }

  return config.ai
}

function normalizeOptionScope(scopeName) {
  const scope = (scopeName || '').trim().toLowerCase()
  if (!scope) {
    throw new IcodeError('缺少 options 作用域。可选: commit|conflict|codereview|push', {
      code: 'AI_OPTIONS_SCOPE_EMPTY',
      exitCode: 2
    })
  }

  if (!ALLOWED_OPTION_SCOPES.has(scope)) {
    throw new IcodeError(`不支持的 options 作用域: ${scopeName}`, {
      code: 'AI_OPTIONS_SCOPE_INVALID',
      exitCode: 2
    })
  }

  return scope
}

function normalizeOptionsPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new IcodeError('options 内容必须是 JSON 对象', {
      code: 'AI_OPTIONS_PAYLOAD_INVALID',
      exitCode: 2
    })
  }

  return payload
}

export function listAiProfiles() {
  const aiConfig = getAiConfig()

  return Object.entries(aiConfig.profiles).map(([name, profile]) => {
    const normalized = normalizeProfile(profile)
    const { apiKey, ...rest } = normalized
    return {
      name,
      ...rest,
      hasApiKey: Boolean(apiKey),
      apiKeyMasked: maskKey(apiKey),
      isActive: aiConfig.activeProfile === name
    }
  })
}

export function listAiCommandOptions() {
  const aiConfig = getAiConfig()
  return clone(aiConfig.options || {})
}

export function getAiCommandOptions(scopeName = '') {
  const aiConfig = getAiConfig()
  if (!scopeName) {
    return clone(aiConfig.options || {})
  }

  const scope = normalizeOptionScope(scopeName)
  const scoped = aiConfig.options?.[scope]
  if (!scoped || typeof scoped !== 'object' || Array.isArray(scoped)) {
    return {}
  }

  return clone(scoped)
}

export function upsertAiCommandOptions(scopeName, payload, options = {}) {
  const scope = normalizeOptionScope(scopeName)
  const normalizedPayload = normalizeOptionsPayload(payload)
  const replace = options.replace === true

  const config = ensureAiSection(readConfig())
  const current = config.ai.options?.[scope]
  const currentObject = current && typeof current === 'object' && !Array.isArray(current) ? current : {}

  config.ai.options[scope] = replace
    ? clone(normalizedPayload)
    : {
        ...currentObject,
        ...clone(normalizedPayload)
      }

  writeConfig(config)
  return clone(config.ai.options[scope])
}

export function removeAiCommandOptions(scopeName) {
  const scope = normalizeOptionScope(scopeName)
  const config = ensureAiSection(readConfig())
  delete config.ai.options[scope]
  writeConfig(config)
}

export function getAiProfile(profileName = '') {
  const aiConfig = getAiConfig()
  const name = (profileName || aiConfig.activeProfile || '').trim()

  if (!name) {
    throw new IcodeError('未配置 AI profile。请先执行: icode config ai set <name> ...', {
      code: 'AI_PROFILE_EMPTY',
      exitCode: 2
    })
  }

  const rawProfile = aiConfig.profiles[name]
  if (!rawProfile) {
    throw new IcodeError(`AI profile 不存在: ${name}`, {
      code: 'AI_PROFILE_MISSING',
      exitCode: 2
    })
  }

  return {
    name,
    ...normalizeProfile(rawProfile)
  }
}

export function upsertAiProfile(profileName, partialProfile) {
  const name = (profileName || '').trim()
  if (!name) {
    throw new IcodeError('profile 名称不能为空', {
      code: 'AI_PROFILE_NAME_EMPTY',
      exitCode: 2
    })
  }

  const config = ensureAiSection(readConfig())
  const current = config.ai.profiles[name] || {}
  const nextProfile = normalizeProfile({
    ...current,
    ...partialProfile
  })

  config.ai.profiles[name] = nextProfile
  if (!config.ai.activeProfile) {
    config.ai.activeProfile = name
  }

  writeConfig(config)
  return {
    name,
    ...nextProfile
  }
}

export function removeAiProfile(profileName) {
  const name = (profileName || '').trim()
  if (!name) {
    throw new IcodeError('profile 名称不能为空', {
      code: 'AI_PROFILE_NAME_EMPTY',
      exitCode: 2
    })
  }

  const config = ensureAiSection(readConfig())
  if (!config.ai.profiles[name]) {
    throw new IcodeError(`AI profile 不存在: ${name}`, {
      code: 'AI_PROFILE_MISSING',
      exitCode: 2
    })
  }

  delete config.ai.profiles[name]

  if (config.ai.activeProfile === name) {
    config.ai.activeProfile = Object.keys(config.ai.profiles)[0] || ''
  }

  writeConfig(config)
}

export function useAiProfile(profileName) {
  const name = (profileName || '').trim()
  if (!name) {
    throw new IcodeError('profile 名称不能为空', {
      code: 'AI_PROFILE_NAME_EMPTY',
      exitCode: 2
    })
  }

  const config = ensureAiSection(readConfig())
  if (!config.ai.profiles[name]) {
    throw new IcodeError(`AI profile 不存在: ${name}`, {
      code: 'AI_PROFILE_MISSING',
      exitCode: 2
    })
  }

  config.ai.activeProfile = name
  writeConfig(config)
  return getAiProfile(name)
}

export function getAiProfileForDisplay(profileName = '') {
  const profile = getAiProfile(profileName)
  const { apiKey, ...rest } = profile
  return {
    ...rest,
    hasApiKey: Boolean(apiKey),
    apiKeyMasked: maskKey(apiKey)
  }
}

export function maskApiKey(value) {
  return maskKey(value)
}
