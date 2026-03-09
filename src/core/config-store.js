import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { IcodeError } from './errors.js'

const DEFAULT_CONFIG = {
  version: 1,
  defaults: {
    repoMode: 'auto',
    defaultMainBranches: ['main', 'master']
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

function cloneDefault() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG))
}

export function readConfig() {
  const configPath = getConfigFilePath()
  ensureDirectory(configPath)

  if (!fs.existsSync(configPath)) {
    const initial = cloneDefault()
    fs.writeFileSync(configPath, JSON.stringify(initial, null, 2), 'utf8')
    return initial
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8')
    if (!content.trim()) {
      const initial = cloneDefault()
      fs.writeFileSync(configPath, JSON.stringify(initial, null, 2), 'utf8')
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
  const configPath = getConfigFilePath()
  ensureDirectory(configPath)
  fs.writeFileSync(configPath, JSON.stringify(nextConfig, null, 2), 'utf8')
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
  return config.repositories[key] || {
    protectedBranches: []
  }
}

export function setRepoPolicy(repoRootPath, policy) {
  const key = normalizeRepoKey(repoRootPath)
  const config = readConfig()
  config.repositories[key] = {
    protectedBranches: [],
    ...(config.repositories[key] || {}),
    ...policy
  }
  writeConfig(config)
  return config.repositories[key]
}
