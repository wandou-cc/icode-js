import { IcodeError } from '../core/errors.js'
import { resolveGitContext } from '../core/git/context.js'
import { GitService } from '../core/git/service.js'
import { chooseMany, chooseOne, isInteractiveTerminal } from '../core/tools/interactive.js'
import { logger } from '../core/tools/logger.js'

const INTERACTIVE_COMMIT_LIMIT = 30

// 归一化分支名，输入为用户参数，输出去除首尾空白后的分支名。
function normalizeBranchName(value) {
  return (value || '').trim()
}

// 归一化提交范围，输入为用户参数，输出去除首尾空白后的 range 表达式。
function normalizeRangeSpec(value) {
  return (value || '').trim()
}

// 构建最近 N 条提交的交互选项，输入最大提交数，输出可供 chooseOne 使用的选项。
function buildRecentCountChoices(maxCount) {
  const candidates = [1, 2, 3, 5, 8, 10]
    .filter((count) => count <= maxCount)
    .map((count) => ({
      value: String(count),
      label: `最近 ${count} 条提交`
    }))

  if (!candidates.length || candidates[candidates.length - 1].value !== String(maxCount)) {
    candidates.push({
      value: String(maxCount),
      label: `最近 ${maxCount} 条提交（全部可选增量）`
    })
  }

  return candidates
}

// 去重并排序分支候选，输入本地/远程分支列表，输出稳定顺序的分支名数组。
function uniqueBranches(branches) {
  return Array.from(new Set((branches || []).map((item) => item.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b))
}

// 读取迁移交互模式的分支候选，输入 GitService，输出本地与 origin 远程分支名。
async function listBranchCandidates(git) {
  const [localBranches, remoteBranches] = await Promise.all([
    git.listLocalBranches(),
    git.listRemoteBranches('origin')
  ])
  return uniqueBranches([...localBranches, ...remoteBranches])
}

// 选择 source/target 分支，输入候选和默认值，输出用户选择的分支名。
async function pickBranch({ label, candidates, defaultValue, excludedBranch = '' }) {
  const excluded = normalizeBranchName(excludedBranch)
  const normalizedDefault = normalizeBranchName(defaultValue)
  const filteredCandidates = candidates.filter((item) => item !== excluded)

  if (!filteredCandidates.length && !normalizedDefault) {
    throw new IcodeError(`无法选择${label}，当前仓库没有可用分支。`, {
      code: 'MIGRATE_BRANCH_PICK_EMPTY',
      exitCode: 2
    })
  }

  const defaultCandidate = normalizedDefault && normalizedDefault !== excluded
    ? normalizedDefault
    : (filteredCandidates[0] || '')

  if (!isInteractiveTerminal()) {
    return defaultCandidate
  }

  const choices = filteredCandidates.map((branch) => ({
    label: branch,
    value: branch
  }))
  choices.push({
    label: '取消',
    value: 'cancel'
  })

  const defaultIndex = Math.max(0, choices.findIndex((item) => item.value === defaultCandidate))
  const selected = await chooseOne(`请选择${label}:`, choices, defaultIndex)
  if (selected === 'cancel') {
    return ''
  }

  return normalizeBranchName(selected)
}

// 手动选择要 cherry-pick 的提交，输入提交 hash 列表，输出被选择的 hash 列表。
async function pickManualCommits(git, commits) {
  const displayCommits = commits.length > INTERACTIVE_COMMIT_LIMIT
    ? commits.slice(-INTERACTIVE_COMMIT_LIMIT)
    : commits

  if (commits.length > INTERACTIVE_COMMIT_LIMIT) {
    logger.warn(`提交较多，仅展示最近 ${INTERACTIVE_COMMIT_LIMIT} 条供手动选择。`)
  }

  const choices = []
  for (const commitHash of displayCommits) {
    const summary = await git.showCommitSummary(commitHash)
    choices.push({
      label: summary || commitHash,
      value: commitHash
    })
  }

  const selected = await chooseMany('请选择要迁移的提交（可多选）:', choices, {
    minSelections: 1,
    doneLabel: '完成提交选择',
    cancelLabel: '取消迁移'
  })

  return Array.isArray(selected) ? selected : []
}

// 解析交互模式迁移计划，输入 GitService 和初始参数，输出 source/target/range/selectedCommits。
async function resolveInteractivePlan(git, options) {
  const candidates = await listBranchCandidates(git)
  const sourceBranch = await pickBranch({
    label: 'source 分支',
    candidates,
    defaultValue: options.sourceBranch || options.currentBranch
  })

  const targetBranch = await pickBranch({
    label: 'target 分支',
    candidates,
    defaultValue: options.targetBranch,
    excludedBranch: sourceBranch
  })

  if (!sourceBranch || !targetBranch) {
    throw new IcodeError('source/target 分支不能为空。', {
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

  if (options.range) {
    return {
      sourceBranch,
      targetBranch,
      range: options.range,
      selectedCommits: [],
      rangeMode: 'custom-range'
    }
  }

  const defaultRange = `${targetBranch}..${sourceBranch}`
  const defaultCommits = await git.revList(defaultRange)
  if (!defaultCommits.length) {
    logger.warn(`默认范围 ${defaultRange} 内没有可迁移提交。`)
    const nextStep = await chooseOne(
      '当前增量为空，下一步：',
      [
        { label: '改为从 source 分支最近提交中多选', value: 'pick-source' },
        { label: '取消迁移', value: 'cancel' }
      ],
      0
    )

    if (nextStep === 'cancel') {
      return {
        canceled: true,
        sourceBranch,
        targetBranch,
        range: defaultRange,
        selectedCommits: [],
        rangeMode: 'all'
      }
    }

    const sourceCommits = await git.revList(sourceBranch)
    const selectedCommits = await pickManualCommits(git, sourceCommits)
    if (!selectedCommits.length) {
      return {
        canceled: true,
        sourceBranch,
        targetBranch,
        range: defaultRange,
        selectedCommits: [],
        rangeMode: 'pick-commits-source'
      }
    }

    return {
      sourceBranch,
      targetBranch,
      range: defaultRange,
      selectedCommits,
      rangeMode: 'pick-commits-source'
    }
  }

  const mode = await chooseOne(
    '请选择迁移范围:',
    [
      { label: `迁移全部增量提交 (${defaultCommits.length} 条)`, value: 'all' },
      { label: '迁移最近 N 条提交', value: 'recent' },
      { label: '手动多选提交', value: 'pick-commits' },
      { label: '取消', value: 'cancel' }
    ],
    0
  )

  if (mode === 'cancel') {
    return {
      canceled: true,
      sourceBranch,
      targetBranch,
      range: defaultRange,
      selectedCommits: [],
      rangeMode: 'all'
    }
  }

  if (mode === 'recent') {
    const countChoices = buildRecentCountChoices(defaultCommits.length)
    const defaultIndex = Math.max(0, countChoices.findIndex((choice) => choice.value === String(Math.min(5, defaultCommits.length))))
    const selectedCount = await chooseOne('请选择迁移提交数:', countChoices, defaultIndex)
    const count = Number(selectedCount)
    return {
      sourceBranch,
      targetBranch,
      range: defaultRange,
      selectedCommits: defaultCommits.slice(-count),
      rangeMode: `recent-${count}`
    }
  }

  if (mode === 'pick-commits') {
    const selectedCommits = await pickManualCommits(git, defaultCommits)
    if (!selectedCommits.length) {
      return {
        canceled: true,
        sourceBranch,
        targetBranch,
        range: defaultRange,
        selectedCommits: [],
        rangeMode: 'pick-commits'
      }
    }
    return {
      sourceBranch,
      targetBranch,
      range: defaultRange,
      selectedCommits,
      rangeMode: 'pick-commits'
    }
  }

  return {
    sourceBranch,
    targetBranch,
    range: defaultRange,
    selectedCommits: [],
    rangeMode: 'all'
  }
}

// 静默模式下输出 info 日志，输入执行选项和日志文本，输出为空。
function logInfo(options, message) {
  if (!options.silentLog) {
    logger.info(message)
  }
}

// 静默模式下输出 warn 日志，输入执行选项和日志文本，输出为空。
function logWarn(options, message) {
  if (!options.silentLog) {
    logger.warn(message)
  }
}

// 检查 migrate 执行前置条件，输入 GitService，输出当前分支和改动摘要。
async function assertMigratePreconditions(git) {
  const [currentBranch, operation, changes] = await Promise.all([
    git.getCurrentBranch(),
    git.getInProgressOperation(),
    git.getStatusSummary()
  ])

  if (!currentBranch) {
    throw new IcodeError('当前不在普通分支上，migrate 已停止。', {
      code: 'MIGRATE_DETACHED_HEAD',
      exitCode: 2
    })
  }

  if (operation) {
    throw new IcodeError(`检测到未完成的 Git 操作: ${operation}。请先完成或中止该操作。`, {
      code: 'MIGRATE_GIT_OPERATION_IN_PROGRESS',
      exitCode: 2,
      meta: {
        operation
      }
    })
  }

  if (!changes.clean) {
    throw new IcodeError('工作区存在未提交改动，migrate 已停止。请先执行 save 或手动清理。', {
      code: 'MIGRATE_DIRTY_WORKTREE',
      exitCode: 2,
      meta: {
        changes
      }
    })
  }

  return {
    currentBranch,
    changes
  }
}

// 将本地/远程分支存在性解析为可用于 rev-list 的 ref，输入分支名和存在性，输出明确 ref。
function resolveBranchRef(branchName, existsLocal, existsRemote, label) {
  if (existsLocal) {
    return branchName
  }

  if (existsRemote) {
    return `origin/${branchName}`
  }

  throw new IcodeError(`${label} 分支不存在: ${branchName}`, {
    code: label === 'source' ? 'MIGRATE_SOURCE_MISSING' : 'MIGRATE_TARGET_MISSING',
    exitCode: 2
  })
}

// 构建提交展示计划，输入提交 hash 列表，输出 hash 与提交摘要列表。
async function buildCommitPlan(git, commits) {
  const plan = []

  for (const commitHash of commits) {
    plan.push({
      hash: commitHash,
      summary: await git.showCommitSummary(commitHash)
    })
  }

  return plan
}

// 构建 migrate 执行步骤，输入计划上下文，输出人类和 agent 都能读取的步骤数组。
function buildMigrateSteps(plan) {
  const steps = [
    {
      action: 'checkout-target',
      detail: plan.targetExistsLocal
        ? `切换到本地目标分支 ${plan.targetBranch}`
        : `从 origin/${plan.targetBranch} 创建 tracking 分支`
    }
  ]

  if (plan.targetExistsRemote) {
    steps.push({
      action: 'pull-target',
      detail: `同步 origin/${plan.targetBranch} 到目标分支`
    })
  }

  steps.push({
    action: 'cherry-pick',
    detail: `迁移 ${plan.commits.length} 个提交`
  })

  if (plan.push) {
    steps.push({
      action: 'push-target',
      detail: `推送目标分支 ${plan.targetBranch}`
    })
  }

  if (plan.originalBranch && plan.originalBranch !== plan.targetBranch) {
    steps.push({
      action: 'restore-branch',
      detail: `切回原分支 ${plan.originalBranch}`
    })
  }

  return steps
}

// 输出迁移计划预览，输入计划对象，输出用户确认前需要看到的关键信息。
function logMigratePlan(options, plan) {
  const previewLimit = 10
  const previewCommits = plan.commits.slice(0, previewLimit)

  logInfo(options, '迁移计划:')
  logInfo(options, `  source: ${plan.sourceBranch} (${plan.sourceRef})`)
  logInfo(options, `  target: ${plan.targetBranch} (${plan.targetRef})`)
  logInfo(options, `  range: ${plan.rangeSpec}`)
  logInfo(options, `  commits: ${plan.migratedCommits}`)

  if (previewCommits.length) {
    logInfo(options, '提交预览:')
    previewCommits.forEach((commit, index) => {
      logInfo(options, `  ${index + 1}. ${commit.summary || commit.hash}`)
    })
  }

  if (plan.commits.length > previewLimit) {
    logInfo(options, `  ... 还有 ${plan.commits.length - previewLimit} 个提交未显示，可用 --dry-run --json 查看完整计划。`)
  }

  logInfo(options, '执行步骤:')
  plan.steps.forEach((step, index) => {
    logInfo(options, `  ${index + 1}. ${step.action}: ${step.detail}`)
  })
}

// 构建迁移计划结果，输入已解析的分支、范围和提交，输出稳定 JSON 结构。
async function buildMigratePlan(git, values) {
  const commits = values.selectedCommits.length
    ? values.selectedCommits
    : await git.revList(values.effectiveRangeSpec)
  const commitPlan = await buildCommitPlan(git, commits)
  const plan = {
    sourceBranch: values.sourceBranch,
    targetBranch: values.targetBranch,
    sourceRef: values.sourceRef,
    targetRef: values.targetRef,
    originalBranch: values.originalBranch,
    rangeSpec: values.effectiveRangeSpec,
    rangeMode: values.rangeMode,
    selectedCommits: values.selectedCommits,
    commits: commitPlan,
    migratedCommits: commits.length,
    targetExistsLocal: values.targetExistsLocal,
    targetExistsRemote: values.targetExistsRemote,
    push: values.push,
    repoRoot: values.repoRoot
  }

  return {
    ...plan,
    steps: buildMigrateSteps(plan)
  }
}

// 执行提交迁移工作流，输入 source/target/range/push/dryRun 等选项，输出迁移结果或计划。
export async function runMigrateWorkflow(options) {
  let sourceBranch = normalizeBranchName(options.sourceBranch)
  let targetBranch = normalizeBranchName(options.targetBranch)
  let rangeSpec = normalizeRangeSpec(options.range)
  let selectedCommits = Array.isArray(options.selectedCommits)
    ? options.selectedCommits.map((item) => String(item).trim()).filter(Boolean)
    : []
  let rangeMode = selectedCommits.length ? 'selected-commits' : 'range'
  const shouldInteractive = Boolean(options.interactive || !sourceBranch || !targetBranch)

  const context = await resolveGitContext({
    cwd: options.cwd,
    repoMode: options.repoMode
  })

  const git = new GitService(context)
  const precheck = await assertMigratePreconditions(git)
  const originalBranch = precheck.currentBranch

  logInfo(options, `仓库根目录: ${context.topLevelPath}`)
  if (context.inheritedFromParent) {
    logWarn(options, '当前目录继承了父级 Git 仓库，命令将基于父仓库根目录执行。')
  }

  await git.fetch()

  if (shouldInteractive) {
    if (!isInteractiveTerminal()) {
      throw new IcodeError('当前终端不支持交互，请显式传入 source/target 分支参数。', {
        code: 'MIGRATE_INTERACTIVE_TTY_REQUIRED',
        exitCode: 2
      })
    }

    const interactivePlan = await resolveInteractivePlan(git, {
      sourceBranch,
      targetBranch,
      currentBranch: originalBranch,
      range: rangeSpec
    })

    if (interactivePlan.canceled) {
      logger.warn('已取消迁移。')
      return {
        canceled: true,
        sourceBranch: interactivePlan.sourceBranch || sourceBranch,
        targetBranch: interactivePlan.targetBranch || targetBranch,
        repoRoot: context.topLevelPath
      }
    }

    sourceBranch = normalizeBranchName(interactivePlan.sourceBranch)
    targetBranch = normalizeBranchName(interactivePlan.targetBranch)
    rangeSpec = normalizeRangeSpec(interactivePlan.range)
    selectedCommits = Array.isArray(interactivePlan.selectedCommits)
      ? interactivePlan.selectedCommits.map((item) => String(item).trim()).filter(Boolean)
      : []
    rangeMode = interactivePlan.rangeMode || rangeMode
  }

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

  const sourceExistsLocal = await git.branchExistsLocal(sourceBranch)
  const sourceExistsRemote = await git.branchExistsRemote(sourceBranch)
  const sourceRef = resolveBranchRef(sourceBranch, sourceExistsLocal, sourceExistsRemote, 'source')

  const targetExistsLocal = await git.branchExistsLocal(targetBranch)
  const targetExistsRemote = await git.branchExistsRemote(targetBranch)
  const targetRef = resolveBranchRef(targetBranch, targetExistsLocal, targetExistsRemote, 'target')

  // 默认迁移 source 相对 target 的增量提交；交互模式可选择最近 N 条或手动挑选提交。
  const effectiveRangeSpec = rangeSpec || `${targetRef}..${sourceRef}`
  const plan = await buildMigratePlan(git, {
    sourceBranch,
    targetBranch,
    sourceRef,
    targetRef,
    originalBranch,
    rangeMode,
    selectedCommits,
    effectiveRangeSpec,
    targetExistsLocal,
    targetExistsRemote,
    push: Boolean(options.push),
    repoRoot: context.topLevelPath
  })

  if (options.dryRun) {
    return {
      dryRun: true,
      ...plan
    }
  }

  const commits = plan.commits.map((commit) => commit.hash)

  if (!commits.length) {
    logWarn(options, '没有可迁移的提交。')
    return {
      dryRun: false,
      sourceBranch,
      targetBranch,
      migratedCommits: 0,
      rangeSpec: effectiveRangeSpec,
      rangeMode,
      repoRoot: context.topLevelPath
    }
  }

  if (!options.yes) {
    logMigratePlan(options, plan)
    const accepted = (await chooseOne(
      '确认执行以上迁移计划吗？',
      [
        { value: 'yes', label: '确认执行' },
        { value: 'no', label: '取消迁移' }
      ],
      0
    )) === 'yes'
    if (!accepted) {
      logger.warn('已取消迁移。')
      return {
        canceled: true,
        sourceBranch,
        targetBranch,
        rangeSpec: effectiveRangeSpec,
        rangeMode,
        repoRoot: context.topLevelPath
      }
    }
  }

  try {
    if (targetExistsLocal) {
      await git.checkout(targetBranch)
    } else {
      await git.checkoutTracking(targetBranch)
    }

    if (targetExistsRemote) {
      await git.pull(targetBranch, {
        noRebase: true
      })
    }

    if (selectedCommits.length) {
      logInfo(options, `迁移范围: 手动选择 ${selectedCommits.length} 个提交（mode=${rangeMode}）`)
    } else {
      logInfo(options, `迁移范围: ${effectiveRangeSpec}`)
    }

    try {
      await git.cherryPick(commits)
    } catch (error) {
      throw new IcodeError(
        '迁移失败: cherry-pick 发生冲突。请先解决冲突后执行 `icode undo --recover continue`，或执行 `icode undo --recover abort` 回滚。',
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
      dryRun: false,
      sourceBranch,
      targetBranch,
      migratedCommits: commits.length,
      rangeSpec: effectiveRangeSpec,
      rangeMode,
      pushed: Boolean(options.push),
      repoRoot: context.topLevelPath
    }
  } finally {
    if (originalBranch && originalBranch !== targetBranch) {
      try {
        await git.checkout(originalBranch)
      } catch (error) {
        logWarn(options, `未能自动切回原分支 ${originalBranch}: ${error.message}`)
      }
    }
  }
}
