import { IcodeError } from '../core/errors.js'
import { resolveGitContext } from '../core/git-context.js'
import { GitService } from '../core/git-service.js'
import { logger } from '../core/logger.js'
import { confirm } from '../core/prompts.js'

function unique(list) {
  return [...new Set(list.map((item) => item.trim()).filter(Boolean))]
}

async function ensureBranchReady(git, branchName) {
  const localExists = await git.branchExistsLocal(branchName)
  const remoteExists = await git.branchExistsRemote(branchName)

  if (!localExists && !remoteExists) {
    return {
      available: false,
      localExists,
      remoteExists
    }
  }

  if (localExists) {
    await git.checkout(branchName)
  } else {
    await git.checkoutTracking(branchName)
  }

  return {
    available: true,
    localExists,
    remoteExists
  }
}

export async function runSyncWorkflow(options) {
  const context = await resolveGitContext({
    cwd: options.cwd,
    repoMode: options.repoMode
  })

  const git = new GitService(context)
  const currentBranch = (await git.getCurrentBranch()) || context.currentBranch

  let targetInput = options.branches?.length
    ? [...options.branches]
    : [currentBranch, context.defaultBranch]

  if (options.allLocal) {
    // all-local 场景下自动拉取全部本地分支，降低人工逐个输入分支名的成本。
    const localBranches = await git.listLocalBranches()
    targetInput = [...localBranches, ...targetInput]
  }

  const targets = unique(targetInput)

  if (!targets.length) {
    throw new IcodeError('没有可同步的分支。', {
      code: 'SYNC_EMPTY_TARGETS',
      exitCode: 2
    })
  }

  logger.info(`仓库根目录: ${context.topLevelPath}`)
  if (context.inheritedFromParent) {
    logger.warn('当前目录继承了父级 Git 仓库，命令将基于父仓库根目录执行。')
  }

  if (!options.yes) {
    const ok = await confirm(`确认同步以下分支: ${targets.join(', ')} ?`, true)
    if (!ok) {
      logger.warn('已取消同步。')
      return {
        canceled: true,
        targets,
        repoRoot: context.topLevelPath
      }
    }
  }

  const summary = []
  await git.fetch()
  const originalBranch = currentBranch

  try {
    for (const branchName of targets) {
      logger.info(`同步分支: ${branchName}`)
      const setup = await ensureBranchReady(git, branchName)

      if (!setup.available) {
        logger.warn(`分支不存在(本地+远程): ${branchName}`)
        summary.push({
          branch: branchName,
          status: 'missing'
        })
        continue
      }

      if (setup.remoteExists) {
        await git.pull(branchName, {
          noRebase: !options.rebase,
          allowUnrelatedHistories: true
        })
      }

      if (options.mergeMain && branchName !== context.defaultBranch) {
        // 把最新主分支合入目标分支，降低后续提测/发布时的冲突概率。
        await git.merge(context.defaultBranch, {
          noFf: true,
          noEdit: true
        })
      }

      if (options.push) {
        await git.push(branchName, {
          setUpstream: !setup.remoteExists,
          noVerify: options.noVerify
        })
      }

      summary.push({
        branch: branchName,
        status: options.push ? 'synced-and-pushed' : 'synced'
      })
    }
  } finally {
    if (originalBranch) {
      try {
        await git.checkout(originalBranch)
      } catch (error) {
        logger.warn(`未能自动切回原分支 ${originalBranch}: ${error.message}`)
      }
    }
  }

  return {
    repoRoot: context.topLevelPath,
    targets,
    summary
  }
}
