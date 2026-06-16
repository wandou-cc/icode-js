import { getAiProfile } from '../core/ai/config.js'
import { IcodeError } from '../core/errors.js'
import { resolveGitContext } from '../core/git/context.js'
import {
  assertNoConflictedFiles,
  assertNoPendingOperation,
  assertOnBranch,
  readGitSafetyState
} from '../core/git/preconditions.js'
import { GitService } from '../core/git/service.js'
import { runAiCommitWorkflow } from './ai-commit-workflow.js'

/**
 * 清理提交信息。
 * 输入为任意字符串，输出去掉首尾空白后的提交信息。
 */
function normalizeMessage(message) {
  return String(message || '').trim()
}

/**
 * 校验 save 的提交信息来源。
 * 输入为 workflow options，输出为空；发现冲突配置时抛错。
 */
function validateMessageSource(options) {
  const hasMessage = Boolean(normalizeMessage(options.message))
  const useAiCommit = options.aiCommit === true

  if (hasMessage && useAiCommit) {
    throw new IcodeError('不能同时使用 --message 和 --ai-commit。请明确选择一种提交信息来源。', {
      code: 'SAVE_MESSAGE_SOURCE_CONFLICT',
      exitCode: 2
    })
  }

  if (!hasMessage && !useAiCommit) {
    throw new IcodeError('缺少提交信息。请使用 --message <msg>，或显式使用 --ai-commit。', {
      code: 'SAVE_MESSAGE_REQUIRED',
      exitCode: 2
    })
  }
}

/**
 * 校验当前仓库是否允许执行 save。
 * 输入为当前分支、未完成操作和改动摘要，输出为空；不满足条件时抛出明确错误。
 */
function validateSavePreconditions(currentBranch, operation, changes) {
  assertOnBranch(currentBranch, 'save', 'SAVE_DETACHED_HEAD')
  assertNoPendingOperation(operation, 'save', 'SAVE_GIT_OPERATION_IN_PROGRESS')
  assertNoConflictedFiles(changes, 'save', 'SAVE_CONFLICTED_FILES')

  if (changes.clean) {
    throw new IcodeError('没有可提交的改动，save 已停止。', {
      code: 'SAVE_NO_CHANGES',
      exitCode: 2
    })
  }
}

/**
 * 构建 dry-run 结果。
 * 输入为上下文、分支、改动和计划提交信息，输出不会产生副作用的预览结构。
 */
function buildDryRunResult(context, currentBranch, changes, commitMessage, source) {
  return {
    applied: false,
    dryRun: true,
    commitId: '',
    commitMessage,
    source,
    context: {
      topLevelPath: context.topLevelPath,
      currentBranch
    },
    changes
  }
}

/**
 * 执行安全快速提交。
 * 输入为 save 参数，输出提交结果；关键假设：dry-run 不执行 add/commit，AI 模式必须使用有效 profile。
 */
export async function runSaveWorkflow(options = {}) {
  validateMessageSource(options)

  const context = await resolveGitContext({
    cwd: options.cwd,
    repoMode: options.repoMode
  })
  const git = new GitService(context)
  const { currentBranch, operation, changes } = await readGitSafetyState(git)

  validateSavePreconditions(currentBranch, operation, changes)

  if (options.aiCommit === true) {
    // AI 模式必须先校验 profile 存在，避免 askAiJson 在缺配置时隐式选择其它配置。
    getAiProfile(options.profile)
    const aiResult = await runAiCommitWorkflow({
      cwd: context.topLevelPath,
      repoMode: 'strict',
      profile: options.profile,
      lang: options.lang || 'zh',
      apply: options.dryRun !== true,
      yes: options.yes === true,
      noVerify: options.noVerify === true,
      silentContextLog: true,
      silentResultLog: true
    })

    if (options.dryRun === true) {
      return buildDryRunResult(context, currentBranch, changes, aiResult.commitMessage, 'ai')
    }

    return {
      applied: aiResult.applied,
      dryRun: false,
      commitId: aiResult.commitId || '',
      commitMessage: aiResult.commitMessage,
      source: 'ai',
      context: {
        topLevelPath: context.topLevelPath,
        currentBranch
      },
      changes
    }
  }

  const commitMessage = normalizeMessage(options.message)
  if (options.dryRun === true) {
    return buildDryRunResult(context, currentBranch, changes, commitMessage, 'message')
  }

  await git.stageAll()
  await git.commit(commitMessage, {
    noVerify: options.noVerify === true
  })
  const commitId = await git.revParseShort('HEAD')

  return {
    applied: true,
    dryRun: false,
    commitId,
    commitMessage,
    source: 'message',
    context: {
      topLevelPath: context.topLevelPath,
      currentBranch
    },
    changes
  }
}
