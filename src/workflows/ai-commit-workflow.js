import { IcodeError } from '../core/errors.js'
import { askAiJson } from '../core/ai/client.js'
import { buildLimitedDiffPrompt, formatDiffCoverage, summarizeDiffCoverage } from '../core/ai/diff-prompt.js'
import { resolveGitContext } from '../core/git/context.js'
import { scanCommitConventions } from '../core/git/commit-conventions.js'
import { GitService } from '../core/git/service.js'
import { confirm } from '../core/tools/interactive.js'
import { logger } from '../core/tools/logger.js'

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

// 将多个 diff 片段稳定拼接，避免空块污染 prompt。
function joinDiffSections(sections) {
  return sections
    .map((item) => (item || '').trim())
    .filter(Boolean)
    .join('\n\n')
}

// 基于“全部未提交改动”生成 AI commit，确保未暂存新文件也能被识别并提交。
export async function runAiCommitWorkflow(options) {
  const context = await resolveGitContext({
    cwd: options.cwd,
    repoMode: options.repoMode
  })
  const git = new GitService(context)

  if (!options.silentContextLog) {
    logger.info(`仓库根目录: ${context.topLevelPath}`)
  }

  const stagedDiff = await git.diffStaged()
  const workingDiff = await git.diffWorkingTree()
  const hasStagedDiff = Boolean(stagedDiff.trim())
  const hasWorkingDiff = Boolean(workingDiff.trim())
  const diff = joinDiffSections([
    hasStagedDiff ? `--- STAGED DIFF ---\n${stagedDiff}` : '',
    hasWorkingDiff ? `--- WORKING TREE DIFF ---\n${workingDiff}` : ''
  ])
  const diffSource = hasStagedDiff && hasWorkingDiff
    ? 'staged+working-tree'
    : hasStagedDiff
      ? 'staged'
      : 'working-tree'

  if (!diff.trim()) {
    throw new IcodeError('没有可用于生成提交信息的代码改动。', {
      code: 'AI_COMMIT_EMPTY_DIFF',
      exitCode: 2
    })
  }

  const limitedDiff = buildLimitedDiffPrompt(diff, {
    limit: 12000
  })
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
      userPrompt: `${conventionPrompt}Based on the following git diff, return JSON with fields:\n{\"type\":\"feat|fix|docs|style|refactor|perf|test|chore|build|ci|revert\",\"scope\":\"optional\",\"subject\":\"required one-line summary\",\"body\":\"optional details\"}\n\nDiff Source: ${diffSource}\n\n${formatDiffCoverage(limitedDiff.coverage)}\n\nDiff:\n${limitedDiff.diff}`
    },
    {
      profile: options.profile
    }
  )

  const commitMessage = buildCommitMessage(parsed)

  if (!options.silentResultLog) {
    logger.success(`AI 建议提交信息:\n${commitMessage}`)
  }

  if (!options.apply) {
    return {
      applied: false,
      commitMessage,
      raw: text,
      diffCoverage: summarizeDiffCoverage(limitedDiff.coverage)
    }
  }

  if (!options.yes) {
    const accepted = await confirm('是否应用该提交信息并执行 commit ?', true)
    if (!accepted) {
      return {
        applied: false,
        commitMessage,
        raw: text,
        diffCoverage: summarizeDiffCoverage(limitedDiff.coverage),
        canceled: true
      }
    }
  }

  if (hasWorkingDiff) {
    // 统一暂存工作区改动，确保未暂存修改和新文件与 AI 看到的 diff 保持一致。
    await git.stageAll()
  }

  await git.commit(commitMessage, {
    noVerify: options.noVerify
  })

  const commitId = await git.revParseShort('HEAD')
  if (commitId && !options.silentResultLog) {
    logger.success(`AI commit 已创建: ${commitId}`)
  }

  return {
    applied: true,
    commitId,
    commitMessage,
    raw: text,
    diffCoverage: summarizeDiffCoverage(limitedDiff.coverage)
  }
}
