import fs from 'node:fs'
import path from 'node:path'
import { askAi } from '../core/ai-client.js'
import { IcodeError } from '../core/errors.js'
import { resolveGitContext } from '../core/git-context.js'
import { GitService } from '../core/git-service.js'
import { logger } from '../core/logger.js'

function extractConflictBlocks(content, maxBlocks = 3, maxLines = 80) {
  const lines = content.split('\n')
  const blocks = []
  let index = 0

  while (index < lines.length && blocks.length < maxBlocks) {
    if (!lines[index].startsWith('<<<<<<<')) {
      index += 1
      continue
    }

    const start = index
    let end = index

    while (end < lines.length && !lines[end].startsWith('>>>>>>>')) {
      end += 1
    }

    if (end < lines.length) {
      end += 1
    }

    const segment = lines.slice(start, Math.min(end, start + maxLines)).join('\n')
    blocks.push(segment)
    index = end
  }

  return blocks
}

export async function runAiConflictWorkflow(options) {
  const context = await resolveGitContext({
    cwd: options.cwd,
    repoMode: options.repoMode
  })
  const git = new GitService(context)

  const conflictedFiles = await git.listConflictedFiles()
  if (!conflictedFiles.length) {
    throw new IcodeError('当前没有检测到冲突文件。', {
      code: 'AI_CONFLICT_NONE',
      exitCode: 2
    })
  }

  const snippets = []
  for (const filePath of conflictedFiles.slice(0, 10)) {
    const absolutePath = path.resolve(context.topLevelPath, filePath)
    if (!fs.existsSync(absolutePath)) {
      continue
    }

    const content = fs.readFileSync(absolutePath, 'utf8')
    const blocks = extractConflictBlocks(content)
    if (!blocks.length) {
      continue
    }

    snippets.push({
      filePath,
      blocks
    })
  }

  if (!snippets.length) {
    throw new IcodeError('冲突文件中没有检测到可解析的冲突块。', {
      code: 'AI_CONFLICT_BLOCKS_EMPTY',
      exitCode: 2
    })
  }

  const rawPayload = snippets
    .map((item) => `FILE: ${item.filePath}\n${item.blocks.map((block, index) => `--- block ${index + 1} ---\n${block}`).join('\n')}`)
    .join('\n\n')

  const payload = rawPayload.length > 14000 ? `${rawPayload.slice(0, 14000)}\n\n...<truncated>` : rawPayload

  logger.info(`检测到冲突文件: ${conflictedFiles.join(', ')}`)

  const suggestion = await askAi(
    {
      systemPrompt: '你是资深代码合并助手。请基于冲突块给出可执行的合并方案。输出中文 Markdown。',
      userPrompt: `请按以下格式输出:\n1) 每个文件的冲突原因\n2) 推荐保留哪一侧或如何融合\n3) 具体手工修改步骤\n4) 修改后需要执行的 git 命令\n\n冲突内容:\n${payload}`
    },
    {
      profile: options.profile
    }
  )

  return {
    conflictedFiles,
    suggestion
  }
}
