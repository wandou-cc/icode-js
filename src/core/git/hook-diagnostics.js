const HOOK_PATTERNS = [
  /husky/i,
  /pre-commit/i,
  /pre-push/i,
  /commit-msg/i,
  /hook failed/i,
  /hook declined/i
]

export function collectCommandOutput(error) {
  const stdout = error?.meta?.stdout || ''
  const stderr = error?.meta?.stderr || ''
  return `${stdout}\n${stderr}`
}

export function detectHookFailure(error) {
  const output = collectCommandOutput(error)
  return HOOK_PATTERNS.some((pattern) => pattern.test(output))
}

export function buildHookHint(action) {
  return `${action} 被 Git hooks/Husky 拦截。若需跳过校验请重试并加上 --no-verify。`
}
