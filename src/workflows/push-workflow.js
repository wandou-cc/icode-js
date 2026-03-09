import { getRepoPolicy } from '../core/config-store.js'
import { IcodeError } from '../core/errors.js'
import { GitService } from '../core/git-service.js'
import { resolveGitContext } from '../core/git-context.js'
import { logger } from '../core/logger.js'
import { confirm, input } from '../core/prompts.js'
import { runAiCommitWorkflow } from './ai-commit-workflow.js'
import { runAiRiskReviewWorkflow } from './ai-risk-review-workflow.js'

function uniqueBranches(branches) {
  return [...new Set(branches.map((item) => item.trim()).filter(Boolean))]
}

function classifyRemoteMergeFailure(error) {
  const output = `${error?.meta?.stderr || ''}\n${error?.meta?.stdout || ''}\n${error?.message || ''}`

  if (/non-fast-forward|fetch first|rejected/i.test(output)) {
    return 'remote-merge-rejected'
  }

  if (/protected branch|permission denied|not allowed|insufficient/i.test(output)) {
    return 'remote-merge-denied'
  }

  return 'remote-merge-failed'
}

async function prepareAiCommitIfEnabled(inputOptions) {
  if (!inputOptions.aiCommit) {
    return {
      enabled: false
    }
  }

  if (inputOptions.message?.trim()) {
    logger.warn('--ai-commit 已启用，将优先使用 AI 生成的提交信息。')
  }

  try {
    const result = await runAiCommitWorkflow({
      apply: true,
      lang: inputOptions.aiCommitLang || 'zh',
      profile: inputOptions.aiProfile,
      repoMode: inputOptions.repoMode,
      noVerify: inputOptions.noVerify,
      yes: inputOptions.yes,
      cwd: inputOptions.cwd,
      silentContextLog: true
    })

    if (result.canceled) {
      logger.warn('已取消 AI 自动提交。')
      return {
        enabled: true,
        canceled: true
      }
    }

    logger.success(`AI 自动提交完成: ${result.commitMessage.split('\n')[0]}`)
    return {
      enabled: true,
      applied: true,
      commitMessage: result.commitMessage
    }
  } catch (error) {
    if (error?.code === 'AI_COMMIT_EMPTY_DIFF') {
      logger.info('未检测到可提交改动，跳过 --ai-commit。')
      return {
        enabled: true,
        skipped: true,
        reason: 'no-diff'
      }
    }

    throw error
  }
}

async function prepareCommitIfNeeded(git, options) {
  const hasChanges = await git.hasChanges()
  if (!hasChanges) {
    logger.info('工作区无改动，跳过 commit。')
    return false
  }

  let message = options.message?.trim()
  if (!message) {
    message = (await input('请输入提交信息', '')).trim()
  }

  if (!message) {
    throw new IcodeError('检测到代码改动但未提供提交信息，请使用 -m 或 --message。', {
      code: 'PUSH_COMMIT_MESSAGE_REQUIRED',
      exitCode: 2
    })
  }

  // 统一自动暂存，降低同学手动 add 的负担。
  await git.stageAll()
  await git.commit(message, {
    noVerify: options.noVerify
  })
  logger.success(`提交完成: ${message}`)
  return true
}

async function checkoutTargetBranch(git, targetBranch, sourceBranch) {
  const localExists = await git.branchExistsLocal(targetBranch)
  const remoteExists = await git.branchExistsRemote(targetBranch)

  if (localExists) {
    await git.checkout(targetBranch)
  } else if (remoteExists) {
    await git.checkoutTracking(targetBranch)
  } else {
    // 目标分支不存在时，默认从 source 分支切出，方便“临时发布分支”场景。
    logger.warn(`目标分支 ${targetBranch} 不存在，将从 ${sourceBranch} 创建。`)
    await git.checkoutNewBranch(targetBranch, sourceBranch)
  }

  if (remoteExists) {
    await git.pull(targetBranch, {
      allowUnrelatedHistories: true,
      noRebase: true
    })
  }

  return {
    remoteExists
  }
}

async function runRemoteMergeMode({
  git,
  currentBranch,
  branchTargets,
  inputOptions,
  protectedBranches
}) {
  const summary = []

  if (inputOptions.notPushCurrent) {
    logger.warn('远程合并模式下 --not-push-current 不生效，当前分支会先推送到远程。')
  }

  const currentRemoteExists = await git.branchExistsRemote(currentBranch)
  if (currentRemoteExists) {
    await git.pull(currentBranch, {
      allowUnrelatedHistories: true,
      noRebase: true
    })
  }

  await git.push(currentBranch, {
    setUpstream: !currentRemoteExists,
    noVerify: inputOptions.noVerify
  })
  summary.push({ branch: currentBranch, status: 'pushed' })

  for (const targetBranch of branchTargets) {
    if (targetBranch === currentBranch) {
      continue
    }

    if (protectedBranches.has(targetBranch) && !inputOptions.forceProtected) {
      logger.warn(`跳过受保护分支: ${targetBranch}（可用 --force-protected 覆盖）`)
      summary.push({ branch: targetBranch, status: 'skipped-protected' })
      continue
    }

    const remoteTargetExists = await git.branchExistsRemote(targetBranch)
    if (!remoteTargetExists) {
      logger.warn(`远程分支不存在，跳过远程合并: ${targetBranch}`)
      summary.push({ branch: targetBranch, status: 'skipped-missing-remote' })
      continue
    }

    try {
      // 远程合并策略: 直接推送 refspec source:target，避免本地切分支和本地 merge。
      await git.pushRefspec(currentBranch, targetBranch, {
        noVerify: inputOptions.noVerify
      })
      summary.push({ branch: targetBranch, status: 'remote-merged' })
    } catch (error) {
      const status = classifyRemoteMergeFailure(error)
      logger.warn(`远程合并失败 ${currentBranch} -> ${targetBranch}: ${error.message}`)
      summary.push({ branch: targetBranch, status })
    }
  }

  return summary
}

export async function runPushWorkflow(inputOptions) {
  const context = await resolveGitContext({
    cwd: inputOptions.cwd,
    repoMode: inputOptions.repoMode
  })

  const git = new GitService(context)
  const policy = getRepoPolicy(context.topLevelPath)
  const protectedBranches = new Set((policy.protectedBranches || []).map((item) => item.trim()).filter(Boolean))

  logger.info(`仓库根目录: ${context.topLevelPath}`)
  if (context.inheritedFromParent) {
    logger.warn('当前目录继承了父级 Git 仓库，命令将基于父仓库根目录执行。')
  }

  const currentBranch = (await git.getCurrentBranch()) || context.currentBranch
  if (!currentBranch) {
    throw new IcodeError('无法识别当前分支，请检查仓库状态。', {
      code: 'PUSH_BRANCH_UNKNOWN',
      exitCode: 2
    })
  }

  const aiCommitResult = await prepareAiCommitIfEnabled(inputOptions)
  if (aiCommitResult.canceled) {
    return {
      canceled: true,
      reason: 'ai-commit-canceled',
      repoRoot: context.topLevelPath,
      currentBranch,
      inheritedFromParent: context.inheritedFromParent
    }
  }

  await prepareCommitIfNeeded(git, inputOptions)
  await git.fetch()

  if (inputOptions.pullMain && context.defaultBranch !== currentBranch) {
    logger.info(`先同步主分支 ${context.defaultBranch} 到当前分支 ${currentBranch}`)
    await git.pull(context.defaultBranch, {
      allowUnrelatedHistories: true,
      noRebase: true
    })
  }

  const remoteMergeMode = Boolean(inputOptions.remoteMerge)
  const branchTargets = uniqueBranches([
    ...(remoteMergeMode ? [currentBranch] : (inputOptions.notPushCurrent ? [] : [currentBranch])),
    ...(inputOptions.targetBranches || [])
  ])

  if (!branchTargets.length) {
    throw new IcodeError('没有可执行的目标分支。', {
      code: 'PUSH_EMPTY_TARGETS',
      exitCode: 2
    })
  }

  let aiReviewResult = null
  if (inputOptions.aiReview) {
    try {
      aiReviewResult = await runAiRiskReviewWorkflow({
        git,
        context,
        currentBranch,
        targetBranches: branchTargets,
        profile: inputOptions.aiProfile
      })

      logger.info(`AI 风险评审: decision=${aiReviewResult.decision}, risk=${aiReviewResult.riskLevel}`)
      if (aiReviewResult.reasons.length) {
        logger.warn(`AI 风险原因: ${aiReviewResult.reasons.join(' | ')}`)
      }

      if (aiReviewResult.decision === 'block') {
        if (inputOptions.yes) {
          logger.warn('AI 风险评审结果为 block，但 --yes 已开启，继续执行。')
        } else {
          const accepted = await confirm('AI 评审建议阻断，是否仍继续 push ?', false)
          if (!accepted) {
            return {
              canceled: true,
              reason: 'ai-review-block',
              branchTargets,
              aiReview: aiReviewResult,
              repoRoot: context.topLevelPath
            }
          }
        }
      }
    } catch (error) {
      logger.warn(`AI 风险评审失败，已跳过: ${error.message}`)
    }
  }

  if (!inputOptions.yes) {
    const confirmed = await confirm(
      `确认将 ${currentBranch} 推送/合并到以下分支: ${branchTargets.join(', ')} ?`,
      true
    )

    if (!confirmed) {
      logger.warn('已取消执行。')
      return {
        canceled: true,
        branchTargets,
        repoRoot: context.topLevelPath
      }
    }
  }

  const summary = []
  const originalBranch = currentBranch

  try {
    if (remoteMergeMode) {
      const remoteSummary = await runRemoteMergeMode({
        git,
        currentBranch,
        branchTargets,
        inputOptions,
        protectedBranches
      })
      return {
        repoRoot: context.topLevelPath,
        currentBranch,
        summary: remoteSummary,
        aiReview: aiReviewResult,
        inheritedFromParent: context.inheritedFromParent
      }
    }

    for (const targetBranch of branchTargets) {
      if (protectedBranches.has(targetBranch) && !inputOptions.forceProtected) {
        logger.warn(`跳过受保护分支: ${targetBranch}（可用 --force-protected 覆盖）`)
        summary.push({ branch: targetBranch, status: 'skipped-protected' })
        continue
      }

      logger.info(`处理分支: ${targetBranch}`)

      if (targetBranch === currentBranch) {
        const remoteExists = await git.branchExistsRemote(targetBranch)
        if (remoteExists) {
          await git.pull(targetBranch, {
            allowUnrelatedHistories: true,
            noRebase: true
          })
        }

        await git.push(targetBranch, {
          setUpstream: !remoteExists,
          noVerify: inputOptions.noVerify
        })

        summary.push({ branch: targetBranch, status: 'pushed' })
        continue
      }

      const { remoteExists } = await checkoutTargetBranch(git, targetBranch, currentBranch)

      // 保留 merge commit，方便后续追溯“从哪个分支合并过来”。
      await git.merge(currentBranch, {
        noFf: true,
        noEdit: true
      })

      await git.push(targetBranch, {
        setUpstream: !remoteExists,
        noVerify: inputOptions.noVerify
      })

      summary.push({ branch: targetBranch, status: 'merged-and-pushed' })
    }
  } finally {
    const branchAfterWorkflow = await git.getCurrentBranch()
    if (branchAfterWorkflow && branchAfterWorkflow !== originalBranch) {
      try {
        await git.checkout(originalBranch)
      } catch (error) {
        logger.warn(`未能自动切回原分支 ${originalBranch}: ${error.message}`)
      }
    }
  }

  return {
    repoRoot: context.topLevelPath,
    currentBranch,
    summary,
    aiReview: aiReviewResult,
    inheritedFromParent: context.inheritedFromParent
  }
}
