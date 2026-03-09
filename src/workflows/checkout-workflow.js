import { IcodeError } from '../core/errors.js'
import { GitService } from '../core/git-service.js'
import { resolveGitContext } from '../core/git-context.js'
import { logger } from '../core/logger.js'

export async function runCheckoutWorkflow(input) {
  if (!input.branchName) {
    throw new IcodeError('缺少分支名: icode checkout <branch> [base]', {
      code: 'CHECKOUT_BRANCH_REQUIRED',
      exitCode: 2
    })
  }

  const context = await resolveGitContext({
    cwd: input.cwd,
    repoMode: input.repoMode
  })

  const git = new GitService(context)
  const branchName = input.branchName.trim()
  const baseBranchName = input.baseBranchName?.trim() || context.defaultBranch

  logger.info(`仓库根目录: ${context.topLevelPath}`)
  if (context.inheritedFromParent) {
    logger.warn('当前目录继承了父级 Git 仓库，命令将基于父仓库根目录执行。')
  }

  await git.fetch()

  const localExists = await git.branchExistsLocal(branchName)
  const remoteExists = await git.branchExistsRemote(branchName)

  if (localExists) {
    logger.info(`切换本地分支: ${branchName}`)
    await git.checkout(branchName)
  } else if (remoteExists) {
    logger.info(`创建并跟踪远程分支: ${branchName}`)
    await git.checkoutTracking(branchName)
  } else {
    const baseLocalExists = await git.branchExistsLocal(baseBranchName)
    const baseRemoteExists = await git.branchExistsRemote(baseBranchName)

    if (!baseLocalExists && !baseRemoteExists) {
      throw new IcodeError(`基线分支不存在: ${baseBranchName}`, {
        code: 'CHECKOUT_BASE_MISSING',
        exitCode: 2
      })
    }

    const fromRef = baseLocalExists ? baseBranchName : `origin/${baseBranchName}`
    logger.info(`从 ${fromRef} 新建分支: ${branchName}`)
    await git.checkoutNewBranch(branchName, fromRef)
  }

  if (input.pullMain && context.defaultBranch !== branchName) {
    logger.info(`同步主分支到当前分支: ${context.defaultBranch}`)
    await git.pull(context.defaultBranch, {
      allowUnrelatedHistories: true,
      noRebase: true
    })
  }

  if (remoteExists) {
    logger.info(`拉取远程分支: ${branchName}`)
    await git.pull(branchName, {
      allowUnrelatedHistories: true,
      noRebase: true
    })
  }

  if (input.pushOrigin && !remoteExists) {
    logger.info(`推送新分支到远程: ${branchName}`)
    await git.push(branchName, {
      setUpstream: true,
      noVerify: input.noVerify
    })
  }

  return {
    branchName,
    baseBranchName,
    remoteExists,
    repoRoot: context.topLevelPath
  }
}
