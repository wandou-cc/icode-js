import { IcodeError } from '../core/errors.js'
import { resolveGitContext } from '../core/git-context.js'
import { GitService } from '../core/git-service.js'
import { logger } from '../core/logger.js'
import { confirm } from '../core/prompts.js'

function normalizeBranchName(value) {
  return (value || '').trim()
}

export async function runMigrateWorkflow(options) {
  const sourceBranch = normalizeBranchName(options.sourceBranch)
  const targetBranch = normalizeBranchName(options.targetBranch)

  if (!sourceBranch || !targetBranch) {
    throw new IcodeError('缺少参数: icode migrate <sourceBranch> <targetBranch>', {
      code: 'MIGRATE_BRANCH_REQUIRED',
      exitCode: 2
    })
  }

  if (sourceBranch === targetBranch) {
    throw new IcodeError('sourceBranch 和 targetBranch 不能相同。', {
      code: 'MIGRATE_BRANCH_DUPLICATED',
      exitCode: 2
    })
  }

  const context = await resolveGitContext({
    cwd: options.cwd,
    repoMode: options.repoMode
  })

  const git = new GitService(context)
  const originalBranch = await git.getCurrentBranch()

  logger.info(`仓库根目录: ${context.topLevelPath}`)
  if (context.inheritedFromParent) {
    logger.warn('当前目录继承了父级 Git 仓库，命令将基于父仓库根目录执行。')
  }

  await git.fetch()

  const sourceExistsLocal = await git.branchExistsLocal(sourceBranch)
  const sourceExistsRemote = await git.branchExistsRemote(sourceBranch)
  if (!sourceExistsLocal && !sourceExistsRemote) {
    throw new IcodeError(`source 分支不存在: ${sourceBranch}`, {
      code: 'MIGRATE_SOURCE_MISSING',
      exitCode: 2
    })
  }

  const targetExistsLocal = await git.branchExistsLocal(targetBranch)
  const targetExistsRemote = await git.branchExistsRemote(targetBranch)

  if (!targetExistsLocal && !targetExistsRemote) {
    throw new IcodeError(`target 分支不存在: ${targetBranch}`, {
      code: 'MIGRATE_TARGET_MISSING',
      exitCode: 2
    })
  }

  try {
    if (targetExistsLocal) {
      await git.checkout(targetBranch)
    } else {
      await git.checkoutTracking(targetBranch)
    }

    if (targetExistsRemote) {
      await git.pull(targetBranch, {
        allowUnrelatedHistories: true,
        noRebase: true
      })
    }

    // 默认迁移 source 相对 target 的增量提交；也支持用 --range 指定范围。
    const rangeSpec = options.range?.trim() || `${targetBranch}..${sourceBranch}`
    const commits = await git.revList(rangeSpec)

    if (!commits.length) {
      logger.warn('没有可迁移的提交。')
      return {
        sourceBranch,
        targetBranch,
        migratedCommits: 0,
        repoRoot: context.topLevelPath
      }
    }

    if (!options.yes) {
      const accepted = await confirm(
        `确认将 ${commits.length} 个提交从 ${sourceBranch} 迁移到 ${targetBranch} 吗？`,
        true
      )
      if (!accepted) {
        logger.warn('已取消迁移。')
        return {
          canceled: true,
          sourceBranch,
          targetBranch,
          repoRoot: context.topLevelPath
        }
      }
    }

    try {
      await git.cherryPick(commits)
    } catch (error) {
      throw new IcodeError(
        '迁移失败: cherry-pick 发生冲突。请先解决冲突后执行 `git cherry-pick --continue`，或执行 `git cherry-pick --abort` 回滚。',
        {
          code: 'MIGRATE_CHERRY_PICK_FAILED',
          cause: error,
          meta: error.meta
        }
      )
    }

    if (options.push) {
      await git.push(targetBranch, {
        setUpstream: !targetExistsRemote,
        noVerify: options.noVerify
      })
    }

    return {
      sourceBranch,
      targetBranch,
      migratedCommits: commits.length,
      pushed: Boolean(options.push),
      repoRoot: context.topLevelPath
    }
  } finally {
    if (originalBranch && originalBranch !== targetBranch) {
      try {
        await git.checkout(originalBranch)
      } catch (error) {
        logger.warn(`未能自动切回原分支 ${originalBranch}: ${error.message}`)
      }
    }
  }
}
