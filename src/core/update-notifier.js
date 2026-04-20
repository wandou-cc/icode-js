import { createRequire } from 'node:module'
import { logger } from './logger.js'
import { runCommand } from './shell.js'

const require = createRequire(import.meta.url)
const packageJson = require('../../package.json')

/**
 * 规范化版本号，输出仅包含数字段的 semver 主体数组。
 * 输入为字符串版本号，输出为数字数组；若格式不合法则返回 null。
 */
function normalizeVersionSegments(version) {
  const normalized = String(version || '').trim()
  if (!normalized) {
    return null
  }

  const coreVersion = normalized.split('-')[0]
  if (!/^\d+(?:\.\d+)*$/.test(coreVersion)) {
    return null
  }

  return coreVersion.split('.').map((segment) => Number(segment))
}

/**
 * 解析 npm view 返回的版本文本，兼容 JSON 字符串与纯文本两种输出。
 * 输入为命令 stdout，输出为去空白后的版本号字符串。
 */
function parsePublishedVersion(stdout) {
  const normalized = String(stdout || '').trim()
  if (!normalized) {
    return ''
  }

  try {
    const parsed = JSON.parse(normalized)
    if (typeof parsed === 'string') {
      return parsed.trim()
    }
  } catch {
    // npm 在异常场景下也可能输出纯文本版本号，这里保留原始文本继续解析。
  }

  return normalized.replace(/^"|"$/g, '').trim()
}

/**
 * 比较两个版本号，判断远端版本是否严格高于当前版本。
 * 输入为当前版本和远端版本，输出为布尔值。
 */
export function hasNewerVersion(currentVersion, latestVersion) {
  const currentSegments = normalizeVersionSegments(currentVersion)
  const latestSegments = normalizeVersionSegments(latestVersion)

  if (!currentSegments || !latestSegments) {
    return false
  }

  const maxLength = Math.max(currentSegments.length, latestSegments.length)
  for (let index = 0; index < maxLength; index += 1) {
    const currentValue = currentSegments[index] || 0
    const latestValue = latestSegments[index] || 0

    if (latestValue > currentValue) {
      return true
    }

    if (latestValue < currentValue) {
      return false
    }
  }

  return false
}

/**
 * 查询 npm registry 上当前包的最新发布版本。
 * 输入为可选 runner/packageName，输出为最新版本号；失败时返回空字符串。
 */
export async function fetchLatestPublishedVersion(options = {}) {
  const packageName = options.packageName || packageJson.name
  const runner = options.runner || runCommand

  try {
    const result = await runner('npm', ['view', packageName, 'version', '--json'], {
      allowFailure: true,
      env: {
        ...process.env,
        NO_UPDATE_NOTIFIER: '1',
        npm_config_update_notifier: 'false',
        npm_config_loglevel: 'silent'
      }
    })

    if (result.exitCode !== 0) {
      return ''
    }

    return parsePublishedVersion(result.stdout)
  } catch {
    return ''
  }
}

/**
 * 在命令成功结束后提示可用更新版本。
 * 输入为可选 runner/warn/packageName/currentVersion，输出为通知结果对象。
 */
export async function notifyIfCliUpdateAvailable(options = {}) {
  const packageName = options.packageName || packageJson.name
  const currentVersion = options.currentVersion || packageJson.version
  const warn = options.warn || logger.warn

  const latestVersion = await fetchLatestPublishedVersion({
    runner: options.runner,
    packageName
  })

  if (!latestVersion || !hasNewerVersion(currentVersion, latestVersion)) {
    return {
      notified: false,
      packageName,
      currentVersion,
      latestVersion
    }
  }

  warn(`发现新版本可用: ${currentVersion} -> ${latestVersion}`)
  warn(`更新命令: npm i -g ${packageName}@latest`)

  return {
    notified: true,
    packageName,
    currentVersion,
    latestVersion
  }
}
