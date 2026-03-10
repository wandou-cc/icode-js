import { IcodeError } from '../core/errors.js'
import { resolveGitContext } from '../core/git-context.js'
import { GitService } from '../core/git-service.js'
import { logger } from '../core/logger.js'
import { chooseMany, chooseOne, isInteractiveTerminal } from '../core/prompts.js'

const INTERACTIVE_COMMIT_LIMIT = 30

function normalizeBranchName(value) {
  return (value || '').trim()
}

function normalizeRangeSpec(value) {
  return (value || '').trim()
}

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

function uniqueBranches(branches) {
  return Array.from(new Set((branches || []).map((item) => item.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b))
}

async function listBranchCandidates(git) {
  const [localBranches, remoteBranches] = await Promise.all([
    git.listLocalBranches(),
    git.listRemoteBranches('origin')
  ])
  return uniqueBranches([...localBranches, ...remoteBranches])
}

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

async function resolveInteractivePlan(git, options) {
  const candidates = await listBranchCandidates(git)
  const sourceBranch = await pickBranch({
    label: 'source 分支',
    candidates,
    defaultValue: options.sourceBranch
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
  const originalBranch = await git.getCurrentBranch()

  logger.info(`仓库根目录: ${context.topLevelPath}`)
  if (context.inheritedFromParent) {
    logger.warn('当前目录继承了父级 Git 仓库，命令将基于父仓库根目录执行。')
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

    // 默认迁移 source 相对 target 的增量提交；交互模式可选择最近 N 条或手动挑选提交。
    const effectiveRangeSpec = rangeSpec || `${targetBranch}..${sourceBranch}`
    const commits = selectedCommits.length ? selectedCommits : await git.revList(effectiveRangeSpec)

    if (selectedCommits.length) {
      logger.info(`迁移范围: 手动选择 ${selectedCommits.length} 个提交（mode=${rangeMode}）`)
    } else {
      logger.info(`迁移范围: ${effectiveRangeSpec}`)
    }

    if (!commits.length) {
      logger.warn('没有可迁移的提交。')
      return {
        sourceBranch,
        targetBranch,
        migratedCommits: 0,
        rangeSpec: effectiveRangeSpec,
        rangeMode,
        repoRoot: context.topLevelPath
      }
    }

    if (!options.yes) {
      const accepted = (await chooseOne(
        `确认将 ${commits.length} 个提交从 ${sourceBranch} 迁移到 ${targetBranch} 吗？`,
        [
          { value: 'yes', label: '确认迁移' },
          { value: 'no', label: '取消' }
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
        logger.warn(`未能自动切回原分支 ${originalBranch}: ${error.message}`)
      }
    }
  }
}
