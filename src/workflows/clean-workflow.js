import { getRepoPolicy } from '../core/config-store.js'
import { IcodeError } from '../core/errors.js'
import { resolveGitContext } from '../core/git-context.js'
import { GitService } from '../core/git-service.js'
import { logger } from '../core/logger.js'
import { confirm } from '../core/prompts.js'

function normalizeKeepList(values = []) {
  return new Set(
    values
      .flatMap((value) => value.split(','))
      .map((item) => item.trim())
      .filter(Boolean)
  )
}

export async function runCleanWorkflow(options) {
  const context = await resolveGitContext({
    cwd: options.cwd,
    repoMode: options.repoMode
  })

  const git = new GitService(context)
  const mergedTarget = (options.mergedTarget || context.defaultBranch).trim()
  const currentBranch = (await git.getCurrentBranch()) || context.currentBranch
  const policy = getRepoPolicy(context.topLevelPath)

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

  if (targetLocalExists) {
    await git.checkout(mergedTarget)
  } else {
    await git.checkoutTracking(mergedTarget)
  }

  if (targetRemoteExists) {
    await git.pull(mergedTarget, {
      allowUnrelatedHistories: true,
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

  try {
    if (currentBranch && currentBranch !== mergedTarget) {
      await git.checkout(currentBranch)
    }
  } catch (error) {
    logger.warn(`未能切回原分支 ${currentBranch}: ${error.message}`)
  }

  return {
    repoRoot: context.topLevelPath,
    mergedTarget,
    deletedLocal,
    deletedRemote
  }
}
