import { getRepoPolicy } from '../core/config/store.js'
import { IcodeError } from '../core/errors.js'
import { resolveGitContext } from '../core/git/context.js'
import {
  assertCleanWorktree,
  assertNoConflictedFiles,
  assertNoPendingOperation,
  assertOnBranch,
  readGitSafetyState
} from '../core/git/preconditions.js'
import { GitService } from '../core/git/service.js'
import { confirm } from '../core/tools/interactive.js'
import { logger } from '../core/tools/logger.js'

function normalizeKeepList(values = []) {
  return new Set(
    values
      .flatMap((value) => value.split(','))
      .map((item) => item.trim())
      .filter(Boolean)
  )
}

/**
 * 执行 clean 工作流。
 * 输入为清理基线、保留分支和删除选项，输出已删除分支；执行前要求工作区干净并在普通分支上。
 */
export async function runCleanWorkflow(options) {
  const context = await resolveGitContext({
    cwd: options.cwd,
    repoMode: options.repoMode
  })

  const git = new GitService(context)
  const mergedTarget = (options.mergedTarget || context.defaultBranch).trim()
  const safetyState = await readGitSafetyState(git)
  const currentBranch = safetyState.currentBranch || context.currentBranch
  const policy = getRepoPolicy(context.topLevelPath)
  assertOnBranch(currentBranch, 'clean', 'CLEAN_DETACHED_HEAD')
  assertNoPendingOperation(safetyState.operation, 'clean', 'CLEAN_GIT_OPERATION_IN_PROGRESS')
  assertNoConflictedFiles(safetyState.changes, 'clean', 'CLEAN_CONFLICTED_FILES')
  assertCleanWorktree(safetyState.changes, 'clean', 'CLEAN_DIRTY_WORKTREE')

  logger.info(`仓库根目录: ${context.topLevelPath}`)
  if (context.inheritedFromParent) {
    logger.warn('当前目录继承了父级 Git 仓库，命令将基于父仓库根目录执行。')
  }

  await git.fetch()

  const targetLocalExists = await git.branchExistsLocal(mergedTarget)
  const targetRemoteExists = await git.branchExistsRemote(mergedTarget)
  if (!targetLocalExists && !targetRemoteExists) {
    throw new IcodeError(`清理基线分支不存在: ${mergedTarget}`, {
      code: 'CLEAN_TARGET_MISSING',
      exitCode: 2
    })
  }

  try {
    if (targetLocalExists) {
      await git.checkout(mergedTarget)
    } else {
      await git.checkoutTracking(mergedTarget)
    }

    if (targetRemoteExists) {
      await git.pull(mergedTarget, {
        noRebase: true
      })
    }

    const mergedBranches = await git.listMergedLocalBranches(mergedTarget)
    const protectedBranches = new Set((policy.protectedBranches || []).map((item) => item.trim()).filter(Boolean))
    const keepSet = normalizeKeepList(options.keep || [])

    // 这些分支永远不进入清理列表，避免误删核心分支。
    keepSet.add(mergedTarget)
    if (context.defaultBranch) {
      keepSet.add(context.defaultBranch)
    }
    if (currentBranch) {
      keepSet.add(currentBranch)
    }
    protectedBranches.forEach((branch) => keepSet.add(branch))

    const candidates = mergedBranches.filter((branch) => !keepSet.has(branch))

    if (!candidates.length) {
      logger.info('没有可清理的本地分支。')
      return {
        repoRoot: context.topLevelPath,
        mergedTarget,
        deletedLocal: [],
        deletedRemote: []
      }
    }

    if (!options.yes) {
      const accepted = await confirm(
        `确认清理以下分支吗: ${candidates.join(', ')} ?`,
        false
      )
      if (!accepted) {
        logger.warn('已取消清理。')
        return {
          canceled: true,
          repoRoot: context.topLevelPath,
          mergedTarget,
          candidates
        }
      }
    }

    const deletedLocal = []
    const deletedRemote = []

    for (const branch of candidates) {
      await git.deleteLocalBranch(branch, {
        force: options.force
      })
      deletedLocal.push(branch)

      if (options.remote) {
        const existsRemote = await git.branchExistsRemote(branch)
        if (existsRemote) {
          await git.deleteRemoteBranch(branch)
          deletedRemote.push(branch)
        }
      }
    }

    return {
      repoRoot: context.topLevelPath,
      mergedTarget,
      deletedLocal,
      deletedRemote
    }
  } finally {
    if (currentBranch && currentBranch !== mergedTarget) {
      try {
        await git.checkout(currentBranch)
      } catch (error) {
        logger.warn(`未能切回原分支 ${currentBranch}: ${error.message}`)
      }
    }
  }
}
