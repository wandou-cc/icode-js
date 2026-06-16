const LEGACY_ALIAS_MAP = new Map([
  ['-pm', '--pull-main'],
  ['--pullMain', '--pull-main'],
  ['--pullMainBranch', '--pull-main'],
  ['--pushOrigin', '--push-origin'],
  ['--localMerge', '--local-merge'],
  ['--notPushCurrent', '--not-push-current'],
  ['--forceProtected', '--force-protected'],
  ['--repoMode', '--repo-mode'],
  ['--noVerify', '--no-verify'],
  ['--allLocal', '--all-local'],
  ['--mergeMain', '--merge-main'],
  ['--aiReview', '--ai-review'],
  ['--aiProfile', '--ai-profile'],
  ['--aiCommit', '--ai-commit'],
  ['--remoteMerge', '--remote-merge'],
  ['--dryRun', '--dry-run'],
  ['--dumpResponse', '--dump-response'],
  ['--mergedTarget', '--merged-target'],
  ['--baseUrl', '--base-url'],
  ['--apiKey', '--api-key'],
  ['--maxTokens', '--max-tokens'],
  ['--requestBody', '--request-body']
])

// 统一历史 camelCase 参数到当前 kebab-case 参数；输入原始 argv，输出可直接交给 parseArgs 的参数。
export function normalizeLegacyArgs(argv = []) {
  return argv.map((arg) => {
    const separatorIndex = String(arg).indexOf('=')
    if (separatorIndex === -1) {
      return LEGACY_ALIAS_MAP.get(arg) || arg
    }

    const key = arg.slice(0, separatorIndex)
    const value = arg.slice(separatorIndex)
    return `${LEGACY_ALIAS_MAP.get(key) || key}${value}`
  })
}

export function parseConfigValue(raw) {
  if (raw === 'true') {
    return true
  }
  if (raw === 'false') {
    return false
  }
  if (raw === 'null') {
    return null
  }
  if (raw === 'undefined') {
    return undefined
  }

  const numberValue = Number(raw)
  if (Number.isFinite(numberValue) && raw.trim() !== '') {
    return numberValue
  }

  if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }

  return raw
}
