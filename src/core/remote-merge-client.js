import { IcodeError } from './errors.js'

function normalizeReason(payload, fallback) {
  const candidates = [
    payload?.reason,
    payload?.message,
    payload?.error,
    payload?.detail
  ]

  for (const item of candidates) {
    if (typeof item === 'string' && item.trim()) {
      return item.trim()
    }
  }

  return fallback
}

export async function requestRemoteMerge(options = {}) {
  const apiKey = String(options.apiKey || '').trim()
  if (!apiKey) {
    throw new IcodeError('远程合并缺少 apiKey', {
      code: 'REMOTE_MERGE_API_KEY_EMPTY',
      exitCode: 2
    })
  }

  const endpoint = process.env.ICODE_REMOTE_MERGE_URL || 'https://api.icodejs.com/v1/merge'
  let response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        provider: options.provider || '',
        sourceBranch: options.sourceBranch,
        targetBranch: options.targetBranch,
        repoRoot: options.repoRoot,
        noVerify: options.noVerify === true
      })
    })
  } catch (error) {
    throw new IcodeError(`远程合并请求失败: ${error?.message || '未知网络错误'}`, {
      code: 'REMOTE_MERGE_FETCH_ERROR',
      exitCode: 2,
      cause: error
    })
  }

  let payload = null
  let rawText = ''

  try {
    rawText = await response.text()
    payload = rawText ? JSON.parse(rawText) : null
  } catch {
    payload = null
  }

  if (!response.ok) {
    return {
      ok: false,
      conflict: response.status === 409,
      status: response.status,
      reason: normalizeReason(payload, `HTTP ${response.status}${rawText ? `: ${rawText.trim()}` : ''}`)
    }
  }

  return {
    ok: payload?.ok !== false,
    conflict: payload?.conflict === true,
    status: response.status,
    reason: normalizeReason(payload, '远程合并已完成'),
    payload
  }
}
