import { formatAiCommitSummary } from '../core/ai/commit-summary.js'
import { getPlatformConfig, getRepoPolicy } from '../core/config/store.js'
import { IcodeError } from '../core/errors.js'
import { resolveGitContext } from '../core/git/context.js'
import {
  assertNoConflictedFiles,
  assertNoPendingOperation,
  readGitSafetyState
} from '../core/git/preconditions.js'
import { GitService } from '../core/git/service.js'
import { confirm, input } from '../core/tools/interactive.js'
import { requestRemoteMerge, resolveRemoteMergeProjectUrl } from '../core/remote-merge/client.js'
import { logger } from '../core/tools/logger.js'
import { runAiCommitWorkflow } from './ai-commit-workflow.js'

function uniqueBranches(branches) {
  return [...new Set(branches.map((item) => item.trim()).filter(Boolean))]
}

// 基于 commit 内容构建远程 MR 标题与正文，确保标题和内容都来自真实提交信息。
async function buildRemoteMergeCommitContent(git, sourceBranch, targetBranch) {
  const rangeSpec = `origin/${targetBranch}..${sourceBranch}`
  let commits = await git.listCommitMessages(rangeSpec)

  if (!commits.length) {
    const latestCommit = await git.getCommitMessage(sourceBranch)
    if (latestCommit) {
      commits = [latestCommit]
    }
  }

  if (!commits.length) {
    throw new IcodeError(`无法读取远程合并提交内容: ${sourceBranch} -> ${targetBranch}`, {
      code: 'PUSH_REMOTE_MERGE_COMMIT_CONTENT_EMPTY',
      exitCode: 2
    })
  }

  const latestCommit = commits[commits.length - 1]
  const description = commits
    .map((commit) => {
      if (commit.body) {
        return `${commit.subject}\n\n${commit.body}`
      }
      return commit.subject
    })
    .join('\n\n')

  return {
    title: latestCommit.subject,
    description
  }
}

// 提取远程合并失败原因，优先使用 IcodeError.meta，其次回退到 error.message。
function resolveRemoteMergeFailureReason(error) {
  const metaStep = typeof error?.meta?.step === 'string' ? error.meta.step.trim() : ''
  const metaReason = typeof error?.meta?.reason === 'string' ? error.meta.reason.trim() : ''
  if (metaReason) {
    return metaStep ? `${metaReason} [step=${metaStep}]` : metaReason
  }

  const message = typeof error?.message === 'string' ? error.message.trim() : ''
  return message || '远程合并失败'
}

// Run AI commit before push and keep the full generated message in follow-up logs.
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

    logger.success(`AI 自动提交完成:\n${formatAiCommitSummary(result.commitId, result.commitMessage)}`)
    return {
      enabled: true,
      applied: true,
      commitId: result.commitId,
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

// 在 push 场景下按需创建本地提交，输入 GitService、命令参数和已读取的改动摘要，输出是否提交。
async function prepareCommitIfNeeded(git, options, changes) {
  if (changes.clean) {
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

// 提取底层 Git 失败细节，输入异常对象，输出用于暂停错误的简洁原因。
function resolveGitFailureReason(error) {
  const stderr = typeof error?.meta?.stderr === 'string' ? error.meta.stderr.trim() : ''
  const stdout = typeof error?.meta?.stdout === 'string' ? error.meta.stdout.trim() : ''
  const output = [stderr, stdout].filter(Boolean).join('\n').trim()
  const message = typeof error?.message === 'string' ? error.message.trim() : ''
  const reason = output || message || 'Git 操作失败'

  return reason.length > 2000 ? `${reason.slice(0, 2000)}...` : reason
}

// 判断 Git 失败是否来自合并冲突，输入异常对象，输出布尔结果。
function isGitConflictFailure(error) {
  const text = [
    error?.meta?.stderr || '',
    error?.meta?.stdout || '',
    error?.message || ''
  ].join('\n')

  return /CONFLICT \(|Automatic merge failed|fix conflicts|unmerged files|needs merge|you need to resolve your current index first/i.test(text)
}

// 构建本地合并暂停错误，输入分支、阶段和原始异常，输出可被命令层汇总的 IcodeError。
function buildLocalMergePauseError({ sourceBranch, targetBranch, step, error, summary = [] }) {
  const reason = resolveGitFailureReason(error)
  const conflict = isGitConflictFailure(error)
  const prefix = conflict ? '本地合并冲突' : '本地合并失败'
  const nextStep = conflict
    ? '请解决冲突后执行 `icode undo --recover continue`，或执行 `icode undo --recover abort` 中止本次合并。'
    : '请根据上面的 Git 错误修复后重试。'

  return new IcodeError(`${prefix}(${step}): ${sourceBranch} -> ${targetBranch}\n${reason}\n${nextStep}`, {
    code: 'PUSH_LOCAL_MERGE_PAUSED',
    exitCode: 2,
    cause: error,
    meta: {
      sourceBranch,
      targetBranch,
      step,
      reason,
      summary
    }
  })
}

async function checkoutTargetBranch(git, targetBranch, sourceBranch, summary = []) {
  const localExists = await git.branchExistsLocal(targetBranch)
  const remoteExists = await git.branchExistsRemote(targetBranch)
  let checkoutMode = 'local'

  if (localExists) {
    await git.checkout(targetBranch)
  } else if (remoteExists) {
    await git.checkoutTracking(targetBranch)
    checkoutMode = 'tracking'
  } else {
    // 目标分支不存在时，默认从 source 分支切出，方便“临时发布分支”场景。
    logger.warn(`目标分支 ${targetBranch} 不存在，将从 ${sourceBranch} 创建。`)
    await git.checkoutNewBranch(targetBranch, sourceBranch)
    checkoutMode = 'created'
  }

  if (remoteExists) {
    try {
      await git.pull(targetBranch, {
        noRebase: true
      })
    } catch (error) {
      throw buildLocalMergePauseError({
        sourceBranch,
        targetBranch,
        step: 'pull-target',
        error,
        summary
      })
    }
  }

  return {
    remoteExists,
    checkoutMode
  }
}

function normalizeRemoteMergePolicy(policy = {}) {
  const remoteMerge = policy.remoteMerge && typeof policy.remoteMerge === 'object' ? policy.remoteMerge : {}
  return {
    enabled: remoteMerge.enabled !== false
  }
}

// 归一化平台级远程合并配置，避免命令层拿到带空白的原始值。
function normalizeRemoteMergePlatformConfig(config = {}) {
  return {
    provider: typeof config.provider === 'string' ? config.provider.trim() : '',
    apiKey: typeof config.apiKey === 'string' ? config.apiKey.trim() : ''
  }
}

function buildRemoteMergePauseError(targetBranch, reason, meta = {}) {
  return new IcodeError(`远程合并已暂停(${targetBranch}): ${reason}`, {
    code: 'PUSH_REMOTE_MERGE_PAUSED',
    exitCode: 2,
    meta: {
      targetBranch,
      reason,
      ...meta
    }
  })
}

// 统一把 provider 返回的 step 注入错误文案，便于定位 create/merge/inspect 具体失败点。
function buildRemoteMergeResultMessage(prefix, result) {
  const reason = typeof result?.reason === 'string' && result.reason.trim()
    ? result.reason.trim()
    : '未知原因'
  const step = typeof result?.step === 'string' && result.step.trim()
    ? result.step.trim()
    : ''

  return step ? `${prefix}(${step}): ${reason}` : `${prefix}: ${reason}`
}

// 构建批量远程合并暂停错误，明确指出具体失败分支与原因。
function buildRemoteMergeBatchPauseError(failures, summary) {
  const branchesLabel = failures.map((item) => item.branch).join(', ')
  const detail = failures.map((item) => `${item.branch}: ${item.reason}`).join(' | ')

  return new IcodeError(`远程合并已暂停(${branchesLabel}): ${detail}`, {
    code: 'PUSH_REMOTE_MERGE_PAUSED',
    exitCode: 2,
    meta: {
      failures,
      summary
    }
  })
}

// 构建 push dry-run 步骤，输入分支目标和策略，输出不会产生副作用的计划列表。
function buildPushDryRunPlan({ currentBranch, branchTargets, protectedBranches, inputOptions }) {
  const steps = []

  if (inputOptions.aiCommit) {
    steps.push({
      action: 'ai-commit',
      branch: currentBranch,
      reason: '将生成并提交 AI commit'
    })
  } else {
    steps.push({
      action: 'commit-if-needed',
      branch: currentBranch,
      reason: inputOptions.message ? '检测到改动时使用 -m/--message 提交' : '检测到改动时会要求输入提交信息'
    })
  }

  if (inputOptions.pullMain) {
    steps.push({
      action: 'pull-main',
      branch: currentBranch,
      reason: '将主分支同步到当前分支'
    })
  }

  branchTargets.forEach((targetBranch) => {
    if (protectedBranches.has(targetBranch) && !inputOptions.forceProtected) {
      steps.push({
        action: 'skip-protected',
        branch: targetBranch,
        reason: '受保护分支，未传 --force-protected'
      })
      return
    }

    if (targetBranch === currentBranch) {
      steps.push({
        action: 'push-current',
        branch: targetBranch,
        reason: '将同步并推送当前分支'
      })
      return
    }

    steps.push({
      action: inputOptions.remoteMerge ? 'remote-merge' : 'local-merge',
      branch: targetBranch,
      reason: inputOptions.remoteMerge ? '将创建并合并远程 MR' : '将切换目标分支、本地 merge 后推送'
    })
  })

  return {
    currentBranch,
    branchTargets,
    remoteMerge: Boolean(inputOptions.remoteMerge),
    steps
  }
}

// 根据 origin 推导远程合并项目 URL，输入平台配置与 remote，输出项目 URL。
function resolveRemoteMergeProjectUrlFromOrigin(remoteMergePlatform, remoteOriginUrl) {
  return {
    projectUrl: resolveRemoteMergeProjectUrl({
      provider: remoteMergePlatform.provider,
      remoteUrl: remoteOriginUrl
    }),
    source: 'origin'
  }
}

// 基于 origin 推导 GitLab 项目地址并发起固定 API 的 MR 创建请求。
async function performRemoteMerge({ git, currentBranch, targetBranch, remoteExists, inputOptions, remoteMergePolicy, remoteMergePlatform }) {
  if (!remoteExists) {
    throw buildRemoteMergePauseError(targetBranch, '远程合并要求目标分支已存在于 origin。', {
      remoteExists: false
    })
  }

  if (!remoteMergePolicy.enabled) {
    throw buildRemoteMergePauseError(targetBranch, '仓库未启用远程合并配置，请先配置 repositories.<repo>.remoteMerge.enabled=true。')
  }

  if (!remoteMergePlatform.apiKey) {
    throw buildRemoteMergePauseError(targetBranch, '平台未配置远程合并密钥，请先执行 icode config platform remote-merge set --provider <name> --api-key <key>。')
  }

  const remoteOriginUrl = await git.getRemoteUrl('origin')
  const { projectUrl, source } = resolveRemoteMergeProjectUrlFromOrigin(remoteMergePlatform, remoteOriginUrl)
  if (!projectUrl) {
    throw buildRemoteMergePauseError(targetBranch, '无法从 origin 自动识别 GitLab 项目 URL，请检查 origin 是否指向 GitLab 仓库。', {
      origin: remoteOriginUrl
    })
  }
  logger.info(`GitLab 项目 URL(${source}): ${logger.color('green', projectUrl)}`)

  logger.info(`发起远程合并: ${logger.color('yellow', currentBranch)} -> ${logger.color('yellow', targetBranch)}`)
  const mergeRequestContent = await buildRemoteMergeCommitContent(git, currentBranch, targetBranch)
  const result = await requestRemoteMerge({
    provider: remoteMergePlatform.provider,
    apiKey: remoteMergePlatform.apiKey,
    projectUrl,
    sourceBranch: currentBranch,
    targetBranch,
    mergeRequestTitle: mergeRequestContent.title,
    mergeRequestDescription: mergeRequestContent.description,
    repoRoot: git.cwd,
    noVerify: inputOptions.noVerify
  })

  if (result.conflict) {
    throw buildRemoteMergePauseError(targetBranch, buildRemoteMergeResultMessage('远程合并冲突', result), {
      sourceBranch: currentBranch,
      step: result.step || '',
      result
    })
  }

  if (!result.ok) {
    throw buildRemoteMergePauseError(targetBranch, buildRemoteMergeResultMessage('远程合并失败', result), {
      sourceBranch: currentBranch,
      step: result.step || '',
      result
    })
  }

  const successReason = typeof result.reason === 'string' && result.reason.trim()
    ? result.reason.trim()
    : '远程合并已完成'

  if (result.mergeRequestUrl) {
    logger.success(`${successReason}: ${logger.color('green', result.mergeRequestUrl)}`)
  } else {
    logger.success(`${successReason}: ${logger.color('yellow', currentBranch)} -> ${logger.color('yellow', targetBranch)}`)
  }

  return result
}

// 并发执行多个远程合并目标分支，并把冲突/失败精确归档到对应分支。
async function runConcurrentRemoteMerges(options) {
  const tasks = options.targetBranches.map(async (targetBranch) => {
    try {
      logger.info(`处理分支: ${targetBranch}`)
      const remoteExists = await options.git.branchExistsRemote(targetBranch)
      const remoteMergeResult = await performRemoteMerge({
        ...options,
        targetBranch,
        remoteExists
      })

      return {
        branch: targetBranch,
        status: 'remote-merged-and-pushed',
        mergeRequestUrl: remoteMergeResult.mergeRequestUrl || '',
        mergeRequestId: remoteMergeResult.mergeRequestId || ''
      }
    } catch (error) {
      return {
        branch: targetBranch,
        status: 'paused',
        reason: resolveRemoteMergeFailureReason(error)
      }
    }
  })

  return Promise.all(tasks)
}

/**
 * 执行 push 工作流。
 * 输入为 push 命令选项，输出推送/合并摘要；关键假设是实际执行前必须没有未完成操作和冲突文件。
 */
export async function runPushWorkflow(inputOptions) {
  const context = await resolveGitContext({
    cwd: inputOptions.cwd,
    repoMode: inputOptions.repoMode
  })

  const git = new GitService(context)
  const policy = getRepoPolicy(context.topLevelPath)
  const protectedBranches = new Set((policy.protectedBranches || []).map((item) => item.trim()).filter(Boolean))
  const remoteMergePolicy = normalizeRemoteMergePolicy(policy)
  const remoteMergePlatform = normalizeRemoteMergePlatformConfig(getPlatformConfig('remoteMerge'))

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

  let branchTargets = uniqueBranches([
    ...(inputOptions.notPushCurrent ? [] : [currentBranch]),
    ...(inputOptions.targetBranches || [])
  ])
  if (inputOptions.notPushCurrent) {
    branchTargets = branchTargets.filter((branchName) => branchName !== currentBranch)
  }

  if (!branchTargets.length) {
    throw new IcodeError('没有可执行的目标分支。', {
      code: 'PUSH_EMPTY_TARGETS',
      exitCode: 2
    })
  }

  if (inputOptions.dryRun) {
    return {
      dryRun: true,
      repoRoot: context.topLevelPath,
      currentBranch,
      inheritedFromParent: context.inheritedFromParent,
      plan: buildPushDryRunPlan({
        currentBranch,
        branchTargets,
        protectedBranches,
        inputOptions
      })
    }
  }

  const safetyState = await readGitSafetyState(git)
  assertNoPendingOperation(safetyState.operation, 'push', 'PUSH_GIT_OPERATION_IN_PROGRESS')
  assertNoConflictedFiles(safetyState.changes, 'push', 'PUSH_CONFLICTED_FILES')

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

  const shouldRunManualCommit = !aiCommitResult.applied && aiCommitResult.reason !== 'no-diff'
  if (shouldRunManualCommit) {
    await prepareCommitIfNeeded(git, inputOptions, safetyState.changes)
  }
  await git.fetch()

  const summary = []

  if (inputOptions.pullMain && context.defaultBranch !== currentBranch) {
    logger.info(`先同步主分支 ${context.defaultBranch} 到当前分支 ${currentBranch}`)
    try {
      await git.pull(context.defaultBranch, {
        noRebase: true
      })
    } catch (error) {
      throw buildLocalMergePauseError({
        sourceBranch: context.defaultBranch,
        targetBranch: currentBranch,
        step: 'pull-main',
        error,
        summary
      })
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

  const originalBranch = currentBranch
  const remoteMergeTargets = []

  try {
    for (const targetBranch of branchTargets) {
      if (protectedBranches.has(targetBranch) && !inputOptions.forceProtected) {
        logger.warn(`跳过受保护分支: ${targetBranch}（可用 --force-protected 覆盖）`)
        summary.push({ branch: targetBranch, status: 'skipped-protected' })
        continue
      }

      if (targetBranch === currentBranch) {
        logger.info(`处理分支: ${targetBranch}`)
        const remoteExists = await git.branchExistsRemote(targetBranch)
        if (remoteExists) {
          logger.info(`同步远程分支: ${targetBranch}`)
          try {
            await git.pull(targetBranch, {
              noRebase: true
            })
          } catch (error) {
            throw buildLocalMergePauseError({
              sourceBranch: `origin/${targetBranch}`,
              targetBranch,
              step: 'pull-current',
              error,
              summary
            })
          }
        }

        logger.info(`推送当前分支: ${targetBranch}`)
        await git.push(targetBranch, {
          setUpstream: !remoteExists,
          noVerify: inputOptions.noVerify
        })

        logger.success(`推送成功: ${targetBranch}`)
        summary.push({ branch: targetBranch, status: 'pushed' })
        continue
      }

      if (inputOptions.remoteMerge) {
        remoteMergeTargets.push(targetBranch)
      } else {
        logger.info(`处理分支: ${targetBranch}`)
        logger.info(`切换到目标分支: ${targetBranch}`)
        const { remoteExists, checkoutMode } = await checkoutTargetBranch(git, targetBranch, currentBranch, summary)
        logger.info(`目标分支准备完成: ${targetBranch} (${checkoutMode})`)

        // 保留 merge commit，方便后续追溯“从哪个分支合并过来”。
        logger.info(`合并分支: ${currentBranch} -> ${targetBranch}`)
        try {
          await git.merge(currentBranch, {
            noFf: true,
            noEdit: true
          })
        } catch (error) {
          throw buildLocalMergePauseError({
            sourceBranch: currentBranch,
            targetBranch,
            step: 'merge-target',
            error,
            summary
          })
        }
        logger.success(`合并成功: ${currentBranch} -> ${targetBranch}`)

        logger.info(`推送目标分支: ${targetBranch}`)
        await git.push(targetBranch, {
          setUpstream: !remoteExists,
          noVerify: inputOptions.noVerify
        })

        logger.success(`目标分支推送成功: ${targetBranch}`)
        summary.push({ branch: targetBranch, status: 'merged-and-pushed' })
      }
    }

    if (inputOptions.remoteMerge && remoteMergeTargets.length) {
      logger.info(`并发处理远程合并分支: ${remoteMergeTargets.join(', ')}`)
      const remoteMergeSummary = await runConcurrentRemoteMerges({
        git,
        currentBranch,
        targetBranches: remoteMergeTargets,
        inputOptions,
        remoteMergePolicy,
        remoteMergePlatform
      })
      summary.push(...remoteMergeSummary)

      const failures = remoteMergeSummary
        .filter((item) => item.status === 'paused')
        .map((item) => ({
          branch: item.branch,
          reason: item.reason || '远程合并失败'
        }))

      if (failures.length) {
        throw buildRemoteMergeBatchPauseError(failures, summary)
      }
    }
  } finally {
    const branchAfterWorkflow = await git.getCurrentBranch()
    const operationAfterWorkflow = await git.getInProgressOperation()
    if (operationAfterWorkflow === 'merge') {
      logger.warn(`检测到未完成的 merge，已保留在当前分支 ${branchAfterWorkflow || '(unknown)'}。`)
      logger.warn('解决冲突后执行 `icode undo --recover continue`，或执行 `icode undo --recover abort` 中止。')
    } else if (branchAfterWorkflow && branchAfterWorkflow !== originalBranch) {
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
    inheritedFromParent: context.inheritedFromParent
  }
}
