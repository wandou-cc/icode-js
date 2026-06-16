// 归一化 diff 字符预算，输入任意 limit，输出正整数预算。
function normalizeLimit(limit) {
  const value = Number(limit)
  return Number.isInteger(value) && value > 0 ? value : 12000
}

// 从 diff 文件头中提取展示路径，输入 `diff --git` 头，输出新路径优先的文件路径。
function extractFilePathFromDiffHeader(header) {
  const match = String(header || '').match(/^diff --git\s+a\/(.+?)\s+b\/(.+)$/)
  if (!match) {
    return ''
  }

  const oldPath = match[1]
  const newPath = match[2]
  if (newPath && newPath !== 'dev/null') {
    return newPath
  }
  return oldPath || ''
}

// 将 unified diff 拆成文件级块，输入为 diff 文本，输出前缀和按文件划分的块；关键假设是 git diff 使用标准 `diff --git` 文件头。
export function splitUnifiedDiffByFile(diff) {
  const text = String(diff || '')
  const markerPattern = /^diff --git .+$/gm
  const markers = [...text.matchAll(markerPattern)]

  if (!markers.length) {
    return {
      prefix: '',
      blocks: []
    }
  }

  const prefix = text.slice(0, markers[0].index).trim()
  const blocks = markers.map((marker, index) => {
    const start = marker.index
    const end = index + 1 < markers.length ? markers[index + 1].index : text.length
    const content = text.slice(start, end).trimEnd()
    return {
      path: extractFilePathFromDiffHeader(marker[0]),
      content,
      length: content.length
    }
  })

  return {
    prefix,
    blocks
  }
}

// 在剩余预算内追加文件 diff 块，输入输出片段、文件块和预算，输出是否完整包含及部分内容。
function appendBlockWithinBudget(parts, block, remainingBudget) {
  if (block.content.length <= remainingBudget) {
    parts.push(block.content)
    return {
      included: true,
      partialContent: ''
    }
  }

  if (remainingBudget <= 120) {
    return {
      included: false,
      partialContent: ''
    }
  }

  const partialContent = `${block.content.slice(0, remainingBudget - 40).trimEnd()}\n...<file diff truncated>`
  parts.push(partialContent)
  return {
    included: false,
    partialContent
  }
}

// 构建 diff 覆盖范围说明，输入截断状态，输出模型可读的覆盖声明。
export function formatDiffCoverage(coverage) {
  if (!coverage.truncated) {
    return [
      'Diff Coverage: full',
      `Total files: ${coverage.totalFiles}`,
      `Original chars: ${coverage.originalChars}`
    ].join('\n')
  }

  const lines = [
    'Diff Coverage: partial',
    `Original chars: ${coverage.originalChars}`,
    `Prompt chars: ${coverage.promptChars}`,
    `Total files: ${coverage.totalFiles}`,
    `Included full file diffs: ${coverage.includedFiles.length ? coverage.includedFiles.join(', ') : '(none)'}`,
    `Included partial file diffs: ${coverage.partialFiles.length ? coverage.partialFiles.join(', ') : '(none)'}`,
    `Omitted file diffs: ${coverage.omittedFiles.length ? coverage.omittedFiles.join(', ') : '(none)'}`,
    'Instruction: treat omitted or partial file diffs as unknown; do not claim they were reviewed in detail.'
  ]

  return lines.join('\n')
}

// 按文件边界限制 diff 长度，输入完整 diff 和字符预算，输出截断后的 diff 与覆盖元信息。
export function buildLimitedDiffPrompt(diff, options = {}) {
  const text = String(diff || '').trimEnd()
  const limit = normalizeLimit(options.limit)

  if (text.length <= limit) {
    const parsed = splitUnifiedDiffByFile(text)
    return {
      diff: text,
      coverage: {
        truncated: false,
        originalChars: text.length,
        promptChars: text.length,
        totalFiles: parsed.blocks.length,
        includedFiles: parsed.blocks.map((block) => block.path).filter(Boolean),
        partialFiles: [],
        omittedFiles: []
      }
    }
  }

  const parsed = splitUnifiedDiffByFile(text)
  if (!parsed.blocks.length) {
    const limitedText = `${text.slice(0, limit).trimEnd()}\n...<diff truncated>`
    return {
      diff: limitedText,
      coverage: {
        truncated: true,
        originalChars: text.length,
        promptChars: limitedText.length,
        totalFiles: 0,
        includedFiles: [],
        partialFiles: ['unknown'],
        omittedFiles: ['unknown']
      }
    }
  }

  const parts = []
  const includedFiles = []
  const partialFiles = []
  const omittedFiles = []
  let usedChars = 0

  if (parsed.prefix) {
    const prefix = parsed.prefix.length > 300 ? `${parsed.prefix.slice(0, 300).trimEnd()}\n...<diff section prefix truncated>` : parsed.prefix
    parts.push(prefix)
    usedChars += prefix.length + 2
  }

  for (let index = 0; index < parsed.blocks.length; index += 1) {
    const block = parsed.blocks[index]
    const separatorCost = parts.length ? 2 : 0
    const remainingBudget = limit - usedChars - separatorCost
    const result = appendBlockWithinBudget(parts, block, remainingBudget)

    if (result.included) {
      includedFiles.push(block.path || '(unknown)')
      usedChars += block.content.length + separatorCost
      continue
    }

    if (result.partialContent) {
      partialFiles.push(block.path || '(unknown)')
      usedChars += result.partialContent.length + separatorCost
    } else {
      omittedFiles.push(block.path || '(unknown)')
    }

    const remainingBlocks = parsed.blocks.slice(index + 1)
    remainingBlocks.forEach((item) => {
      omittedFiles.push(item.path || '(unknown)')
    })
    break
  }

  const limitedText = parts.join('\n\n').trimEnd()
  return {
    diff: limitedText,
    coverage: {
      truncated: true,
      originalChars: text.length,
      promptChars: limitedText.length,
      totalFiles: parsed.blocks.length,
      includedFiles,
      partialFiles,
      omittedFiles
    }
  }
}

// 从覆盖信息中生成简短统计，输入 coverage，输出便于命令结果或测试读取的结构。
export function summarizeDiffCoverage(coverage) {
  return {
    truncated: coverage.truncated,
    totalFiles: coverage.totalFiles,
    includedFiles: coverage.includedFiles.length,
    partialFiles: coverage.partialFiles.length,
    omittedFiles: coverage.omittedFiles.length,
    originalChars: coverage.originalChars,
    promptChars: coverage.promptChars
  }
}
