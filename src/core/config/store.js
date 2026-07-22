import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { IcodeError } from '../errors.js'

const DEFAULT_CONFIG = {
  version: 1,
  defaults: {
    repoMode: 'auto',
    defaultMainBranches: ['main', 'master']
  },
  platforms: {
    remoteMerge: {
      provider: '',
      apiKey: ''
    }
  },
  ai: {
    activeProfile: '',
    profiles: {},
    options: {}
  },
  repositories: {}
}

export function getConfigFilePath() {
  if (process.env.ICODE_CONFIG_PATH) {
    return path.resolve(process.env.ICODE_CONFIG_PATH)
  }

  const homePath = os.homedir()
  const legacyPath = path.resolve(homePath, '.icode')
  const modernPath = path.resolve(homePath, '.icode', 'config.json')

  if (fs.existsSync(legacyPath)) {
    const legacyStats = fs.statSync(legacyPath)
    if (legacyStats.isFile()) {
      return legacyPath
    }
  }

  return modernPath
}

function ensureDirectory(filePath) {
  const dirPath = path.dirname(filePath)
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function secureConfigFile(filePath) {
  try {
    fs.chmodSync(filePath, 0o600)
  } catch (error) {
    throw new IcodeError(`无法设置配置文件权限: ${filePath}`, {
      code: 'CONFIG_PERMISSION_ERROR',
      cause: error
    })
  }
}

function writeConfigFile(filePath, config) {
  ensureDirectory(filePath)
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`

  try {
    fs.writeFileSync(tempPath, JSON.stringify(config, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    })
    fs.renameSync(tempPath, filePath)
    secureConfigFile(filePath)
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true })
    } catch {
      // 保留原始写入异常。
    }

    if (error instanceof IcodeError) {
      throw error
    }
    throw new IcodeError(`配置文件写入失败: ${filePath}`, {
      code: 'CONFIG_WRITE_ERROR',
      cause: error
    })
  }
}

function cloneDefault() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG))
}

export function readConfig() {
  const configPath = getConfigFilePath()
  ensureDirectory(configPath)

  if (!fs.existsSync(configPath)) {
    const initial = cloneDefault()
    writeConfigFile(configPath, initial)
    return initial
  }

  try {
    secureConfigFile(configPath)
    const content = fs.readFileSync(configPath, 'utf8')
    if (!content.trim()) {
      const initial = cloneDefault()
      writeConfigFile(configPath, initial)
      return initial
    }

    const parsed = JSON.parse(content)

    return {
      ...cloneDefault(),
      ...parsed,
      defaults: {
        ...cloneDefault().defaults,
        ...(parsed.defaults || {})
      },
      platforms: {
        ...cloneDefault().platforms,
        ...(parsed.platforms || {}),
        remoteMerge: {
          ...cloneDefault().platforms.remoteMerge,
          ...(parsed.platforms?.remoteMerge || {})
        }
      },
      ai: {
        ...cloneDefault().ai,
        ...(parsed.ai || {}),
        profiles: {
          ...(parsed.ai?.profiles || {})
        },
        options: {
          ...(parsed.ai?.options && typeof parsed.ai.options === 'object' && !Array.isArray(parsed.ai.options)
            ? parsed.ai.options
            : {})
        }
      },
      repositories: {
        ...(parsed.repositories || {})
      }
    }
  } catch (error) {
    throw new IcodeError(`配置文件解析失败: ${configPath}`, {
      code: 'CONFIG_PARSE_ERROR',
      cause: error
    })
  }
}

export function writeConfig(nextConfig) {
  writeConfigFile(getConfigFilePath(), nextConfig)
}

function splitPathSegments(pathExpression) {
  return pathExpression
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean)
}

export function getValue(pathExpression) {
  const config = readConfig()
  const segments = splitPathSegments(pathExpression)

  let pointer = config
  for (const segment of segments) {
    if (pointer == null || typeof pointer !== 'object') {
      return undefined
    }
    pointer = pointer[segment]
  }

  return pointer
}

export function setValue(pathExpression, value) {
  const config = readConfig()
  const segments = splitPathSegments(pathExpression)

  if (!segments.length) {
    throw new IcodeError('配置路径不能为空', { code: 'CONFIG_PATH_EMPTY' })
  }

  let pointer = config
  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index]
    if (pointer[key] == null || typeof pointer[key] !== 'object') {
      pointer[key] = {}
    }
    pointer = pointer[key]
  }

  pointer[segments[segments.length - 1]] = value
  writeConfig(config)
  return config
}

export function deleteValue(pathExpression) {
  const config = readConfig()
  const segments = splitPathSegments(pathExpression)

  if (!segments.length) {
    throw new IcodeError('配置路径不能为空', { code: 'CONFIG_PATH_EMPTY' })
  }

  let pointer = config
  for (let index = 0; index < segments.length - 1; index += 1) {
    pointer = pointer?.[segments[index]]
    if (pointer == null || typeof pointer !== 'object') {
      return config
    }
  }

  delete pointer[segments[segments.length - 1]]
  writeConfig(config)
  return config
}

function normalizeRepoKey(repoRootPath) {
  return path.resolve(repoRootPath)
}

export function getRepoPolicy(repoRootPath) {
  const key = normalizeRepoKey(repoRootPath)
  const config = readConfig()
  return {
    protectedBranches: [],
    remoteMerge: {
      enabled: true
    },
    ...(config.repositories[key] || {})
  }
}

export function setRepoPolicy(repoRootPath, policy) {
  const key = normalizeRepoKey(repoRootPath)
  const config = readConfig()
  config.repositories[key] = {
    protectedBranches: [],
    remoteMerge: {
      enabled: true
    },
    ...(config.repositories[key] || {}),
    ...policy
  }
  writeConfig(config)
  return config.repositories[key]
}

export function getPlatformConfig(platformName) {
  const config = readConfig()
  const name = String(platformName || '').trim()
  if (!name) {
    return {}
  }

  return config.platforms?.[name] || {}
}

export function setPlatformConfig(platformName, value) {
  const config = readConfig()
  const name = String(platformName || '').trim()
  if (!name) {
    throw new IcodeError('平台名称不能为空', { code: 'CONFIG_PLATFORM_EMPTY', exitCode: 2 })
  }

  config.platforms = {
    ...(config.platforms || {}),
    [name]: {
      ...(config.platforms?.[name] || {}),
      ...(value || {})
    }
  }

  writeConfig(config)
  return config.platforms[name]
}
