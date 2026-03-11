import { IcodeError } from '../core/errors.js'
import { resolveGitContext } from '../core/git-context.js'
import { GitService } from '../core/git-service.js'
import { logger } from '../core/logger.js'
import { askAiJson } from '../core/ai-client.js'
import { scanCommitConventions } from '../core/commit-conventions.js'
import { confirm } from '../core/prompts.js'

function normalizeCommitType(value) {
  const allowed = new Set(['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'chore', 'build', 'ci', 'revert'])
  const normalized = (value || '').trim().toLowerCase()
  return allowed.has(normalized) ? normalized : 'chore'
}

function buildCommitMessage(parsed) {
  const type = normalizeCommitType(parsed.type)
  const scope = (parsed.scope || '').trim()
  const subject = (parsed.subject || '').trim().replace(/\n/g, ' ')

  if (!subject) {
    throw new IcodeError('AI 未返回有效的提交标题(subject)。', {
      code: 'AI_COMMIT_SUBJECT_EMPTY',
      exitCode: 2
    })
  }

  const header = scope ? `${type}(${scope}): ${subject}` : `${type}: ${subject}`
  const body = (parsed.body || '').trim()
  if (!body) {
    return header
  }

  return `${header}\n\n${body}`
}

export async function runAiCommitWorkflow(options) {
  const context = await resolveGitContext({
    cwd: options.cwd,
    repoMode: options.repoMode
  })
  const git = new GitService(context)

  if (!options.silentContextLog) {
    logger.info(`仓库根目录: ${context.topLevelPath}`)
  }

  let diff = await git.diffStaged()
  let diffSource = 'staged'

  if (!diff.trim()) {
    diff = await git.diffWorkingTree()
    diffSource = 'working-tree'
  }

  if (!diff.trim()) {
    throw new IcodeError('没有可用于生成提交信息的代码改动。', {
      code: 'AI_COMMIT_EMPTY_DIFF',
      exitCode: 2
    })
  }

  const limitedDiff = diff.length > 12000 ? `${diff.slice(0, 12000)}\n\n...<truncated>` : diff
  const conventionContext = scanCommitConventions(context)
  const conventionPrompt = conventionContext.hasConventions
    ? `Local commit conventions were detected from repository hooks/config files. Follow these local rules first when generating the commit message.\n\n${conventionContext.summary}\n\n`
    : ''

  const language = (options.lang || 'zh').trim().toLowerCase() === 'en' ? 'English' : 'Chinese'

  if (conventionContext.hasConventions && !options.silentContextLog) {
    logger.info(`检测到提交规范配置，AI 将优先参考: ${conventionContext.sources.join(', ')}`)
  }

  const { parsed, text } = await askAiJson(
    {
      systemPrompt: `You are a senior software engineer. Generate a concise Conventional Commit message. Output JSON only. Language: ${language}.`,
      userPrompt: `${conventionPrompt}Based on the following git diff, return JSON with fields:\n{\"type\":\"feat|fix|docs|style|refactor|perf|test|chore|build|ci|revert\",\"scope\":\"optional\",\"subject\":\"required one-line summary\",\"body\":\"optional details\"}\n\nDiff Source: ${diffSource}\n\nDiff:\n${limitedDiff}`
    },
    {
      profile: options.profile
    }
  )

  const commitMessage = buildCommitMessage(parsed)

  logger.success(`AI 建议提交信息:\n${commitMessage}`)

  if (!options.apply) {
    return {
      applied: false,
      commitMessage,
      raw: text
    }
  }

  if (!options.yes) {
    const accepted = await confirm('是否应用该提交信息并执行 commit ?', true)
    if (!accepted) {
      return {
        applied: false,
        commitMessage,
        raw: text,
        canceled: true
      }
    }
  }

  if (diffSource === 'working-tree') {
    // 从 working-tree 生成信息时，提交前统一暂存，避免 commit 为空。
    await git.stageAll()
  }

  await git.commit(commitMessage, {
    noVerify: options.noVerify
  })

  const commitId = await git.revParseShort('HEAD')
  if (commitId) {
    logger.success(`AI commit 已创建: ${commitId}`)
  }

  return {
    applied: true,
    commitId,
    commitMessage,
    raw: text
  }
}
