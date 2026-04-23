// 提取错误负载里的可读文本，兼容字符串、数组和对象三类常见结构。
function collectReasonParts(value) {
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()]
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectReasonParts(item))
  }

  if (value && typeof value === 'object') {
    return Object.values(value).flatMap((item) => collectReasonParts(item))
  }

  return []
}

// 统一归一化远程合并返回原因，优先读取结构化字段，缺失时回退到兜底文案。
export function normalizeRemoteMergeReason(payload, fallback) {
  const candidates = [
    payload?.reason,
    payload?.message,
    payload?.error,
    payload?.detail
  ]

  for (const item of candidates) {
    const parts = collectReasonParts(item)
    if (parts.length) {
      return parts.join('; ')
    }
  }

  return fallback
}

// 尝试把响应文本解析成 JSON，解析失败时返回 null，避免上层重复写 try/catch。
export function parseRemoteMergePayload(rawText = '') {
  const normalizedText = String(rawText || '')
  if (!normalizedText.trim()) {
    return null
  }

  try {
    return JSON.parse(normalizedText)
  } catch {
    return null
  }
}
