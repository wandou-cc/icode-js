const LEGACY_ALIAS_MAP = new Map([
  ['-pm', '--pull-main'],
  ['--pullMainBranch', '--pull-main'],
  ['--pushOrigin', '--push-origin'],
  ['--notPushCurrent', '--not-push-current'],
  ['--repoMode', '--repo-mode'],
  ['--noVerify', '--no-verify'],
  ['--allLocal', '--all-local'],
  ['--mergeMain', '--merge-main'],
  ['--aiReview', '--ai-review'],
  ['--aiProfile', '--ai-profile'],
  ['--aiCommit', '--ai-commit']
])

export function normalizeLegacyArgs(argv = []) {
  return argv.map((arg) => LEGACY_ALIAS_MAP.get(arg) || arg)
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
