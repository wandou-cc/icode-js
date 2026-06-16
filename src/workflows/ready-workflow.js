import { getAiConfig } from '../core/ai/config.js'
import { getPlatformConfig, getRepoPolicy } from '../core/config/store.js'
import { resolveGitContext } from '../core/git/context.js'
import { GitService } from '../core/git/service.js'

/**
 * 构建 ready 检查项。
 * 输入为检查字段，输出稳定的检查项对象；关键假设是 status 只能是 pass/warn/fail。
 */
function buildCheck(id, status, title, detail, nextStep = '') {
  return {
    id,
    status,
    title,
    detail,
    nextStep
  }
}

/**
 * 汇总 ready 检查状态。
 * 输入为检查项数组，输出整体 ok/status 和计数。
 */
function summarizeReadyChecks(checks) {
  const summary = {
    ok: true,
    status: 'pass',
    pass: 0,
    warn: 0,
    fail: 0
  }

  for (const check of checks) {
    if (check.status === 'fail') {
      summary.ok = false
      summary.status = 'fail'
      summary.fail += 1
      continue
    }

    if (check.status === 'warn') {
      summary.warn += 1
      if (summary.status !== 'fail') {
        summary.status = 'warn'
      }
      continue
    }

    summary.pass += 1
  }

  return summary
}

/**
 * 从检查项提取下一步建议。
 * 输入为检查项数组，输出去重后的建议文本数组。
 */
function collectNextSteps(checks) {
  const nextSteps = []
  const seen = new Set()

  for (const check of checks) {
    const nextStep = String(check.nextStep || '').trim()
    if (!nextStep || seen.has(nextStep)) {
      continue
    }
    seen.add(nextStep)
    nextSteps.push(nextStep)
  }

  return nextSteps
}

/**
 * 检查当前分支是否存在。
 * 输入为分支名，输出 ready 检查项。
 */
function checkCurrentBranch(currentBranch) {
  if (!currentBranch) {
    return buildCheck(
      'git.branch',
      'fail',
      '当前不在普通分支上',
      '检测到 detached HEAD 或无法读取当前分支。',
      '请先切换到明确分支，例如: icode checkout <branch>'
    )
  }

  return buildCheck('git.branch', 'pass', '当前分支明确', currentBranch)
}

/**
 * 检查是否存在未完成的 Git 操作。
 * 输入为 operation 字符串，输出 ready 检查项。
 */
function checkInProgressOperation(operation) {
  if (!operation) {
    return buildCheck('git.operation', 'pass', '没有未完成的 Git 操作', '工作区未处于 merge/rebase/cherry-pick/revert 流程中。')
  }

  return buildCheck(
    'git.operation',
    'fail',
    '存在未完成的 Git 操作',
    `当前操作: ${operation}`,
    `请先完成或中止 ${operation}，再继续执行 save/push。`
  )
}

/**
 * 检查工作区改动情况。
 * 输入为结构化改动摘要，输出 ready 检查项。
 */
function checkChanges(changes) {
  if (changes.conflicted > 0) {
    return buildCheck(
      'git.changes',
      'fail',
      '存在未解决冲突',
      `冲突文件 ${changes.conflicted} 个，全部改动 ${changes.total} 个。`,
      '请先解决冲突；如需要建议可执行: icode ai conflict'
    )
  }

  if (!changes.clean) {
    return buildCheck(
      'git.changes',
      'warn',
      '存在未提交改动',
      `staged=${changes.staged}, unstaged=${changes.unstaged}, untracked=${changes.untracked}`,
      '如需安全快速提交，可执行: icode save -m "type: subject"'
    )
  }

  return buildCheck('git.changes', 'pass', '工作区干净', '没有暂存、未暂存或未跟踪改动。')
}

/**
 * 检查 upstream 关系。
 * 输入为 upstream 状态，输出 ready 检查项。
 */
function checkUpstream(upstreamStatus) {
  if (!upstreamStatus.configured) {
    return buildCheck(
      'git.upstream',
      'warn',
      '当前分支未设置 upstream',
      '无法判断本地与远程领先/落后关系。',
      '如需建立远程跟踪关系，可在首次推送时使用: icode push -m "type: subject"'
    )
  }

  if (upstreamStatus.behind > 0) {
    return buildCheck(
      'git.upstream',
      'warn',
      '当前分支落后 upstream',
      `${upstreamStatus.upstream}: ahead=${upstreamStatus.ahead}, behind=${upstreamStatus.behind}`,
      '建议先同步远程变更: icode sync'
    )
  }

  if (upstreamStatus.ahead > 0) {
    return buildCheck(
      'git.upstream',
      'warn',
      '当前分支有未推送提交',
      `${upstreamStatus.upstream}: ahead=${upstreamStatus.ahead}, behind=${upstreamStatus.behind}`,
      '如需发布当前分支，可执行: icode push'
    )
  }

  return buildCheck(
    'git.upstream',
    'pass',
    'upstream 已同步',
    `${upstreamStatus.upstream}: ahead=0, behind=0`
  )
}

/**
 * 检查 AI profile 是否可用于 AI 场景。
 * 输入为 AI 配置，输出 ready 检查项。
 */
function checkAiProfile(aiConfig) {
  const activeProfile = String(aiConfig.activeProfile || '').trim()
  const profileCount = Object.keys(aiConfig.profiles || {}).length

  if (!activeProfile || profileCount === 0) {
    return buildCheck(
      'ai.profile',
      'warn',
      'AI profile 未配置',
      'save --ai-commit、codereview、explain 等能力不可用。',
      '如需 AI 能力，请先执行: icode config ai set <name> ... --activate'
    )
  }

  return buildCheck('ai.profile', 'pass', 'AI profile 可用', `activeProfile=${activeProfile}, profileCount=${profileCount}`)
}

/**
 * 检查远程合并配置是否可用于 remote-merge 场景。
 * 输入为平台配置和仓库策略，输出 ready 检查项。
 */
function checkRemoteMerge(remoteMergePlatform, repoPolicy) {
  const repoRemoteMerge = repoPolicy.remoteMerge && typeof repoPolicy.remoteMerge === 'object'
    ? repoPolicy.remoteMerge
    : {}

  if (repoRemoteMerge.enabled === false) {
    return buildCheck('remoteMerge.config', 'pass', '远程合并已禁用', '当前仓库策略明确禁用 remote merge。')
  }

  if (!remoteMergePlatform.provider || !remoteMergePlatform.apiKey) {
    return buildCheck(
      'remoteMerge.config',
      'warn',
      '远程合并配置不完整',
      '缺少 provider 或 apiKey，push -r 不可用。',
      '如需远程合并，请执行: icode config platform remote-merge set --provider gitlab --api-key <key>'
    )
  }

  return buildCheck('remoteMerge.config', 'pass', '远程合并配置可用', `provider=${remoteMergePlatform.provider}`)
}

/**
 * 执行场景化就绪检查。
 * 输入为仓库选项，输出面向人类和 AI agent 的稳定状态结构。
 */
export async function runReadyWorkflow(options = {}) {
  const context = await resolveGitContext({
    cwd: options.cwd,
    repoMode: options.repoMode
  })
  const git = new GitService(context)
  const [currentBranch, operation, changes, upstream] = await Promise.all([
    git.getCurrentBranch(),
    git.getInProgressOperation(),
    git.getStatusSummary(),
    git.getUpstreamStatus()
  ])
  const aiConfig = getAiConfig()
  const repoPolicy = getRepoPolicy(context.topLevelPath)
  const remoteMergePlatform = getPlatformConfig('remoteMerge')

  const checks = [
    checkCurrentBranch(currentBranch),
    checkInProgressOperation(operation),
    checkChanges(changes),
    checkUpstream(upstream),
    checkAiProfile(aiConfig),
    checkRemoteMerge(remoteMergePlatform, repoPolicy)
  ]
  const summary = summarizeReadyChecks(checks)

  return {
    ok: summary.ok,
    status: summary.status,
    summary,
    context: {
      cwd: context.cwd,
      topLevelPath: context.topLevelPath,
      repoMode: context.repoMode,
      currentBranch,
      defaultBranch: context.defaultBranch,
      inheritedFromParent: context.inheritedFromParent,
      isSubmodule: context.isSubmodule
    },
    operation,
    changes,
    upstream,
    checks,
    nextSteps: collectNextSteps(checks)
  }
}
