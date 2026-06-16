import { getAiConfig } from '../core/ai/config.js'
import { getConfigFilePath, getPlatformConfig, getRepoPolicy } from '../core/config/store.js'
import { resolveGitContext } from '../core/git/context.js'
import { GitService } from '../core/git/service.js'
import { runCommand } from '../core/commands/shell.js'

// 构建单条健康检查结果，输入检查项字段，输出统一结构。
function buildCheck(id, status, title, detail, suggestion = '') {
  return {
    id,
    status,
    title,
    detail,
    suggestion
  }
}

// 汇总检查结果状态，输入 checks 数组，输出整体状态与计数。
function summarizeChecks(checks) {
  const summary = {
    status: 'pass',
    pass: 0,
    warn: 0,
    fail: 0
  }

  checks.forEach((check) => {
    if (check.status === 'fail') {
      summary.fail += 1
      summary.status = 'fail'
      return
    }
    if (check.status === 'warn') {
      summary.warn += 1
      if (summary.status !== 'fail') {
        summary.status = 'warn'
      }
      return
    }
    summary.pass += 1
  })

  return summary
}

// 检查 git 命令可用性，输入仓库根目录，输出健康检查项。
async function checkGitVersion(repoRoot) {
  const result = await runCommand('git', ['--version'], {
    cwd: repoRoot,
    allowFailure: true
  })

  if (result.exitCode !== 0) {
    return buildCheck('git.version', 'fail', 'Git 命令不可用', '无法执行 git --version。', '请先安装 Git 并确认 PATH 配置正确。')
  }

  return buildCheck('git.version', 'pass', 'Git 命令可用', result.stdout.trim())
}

// 检查 origin remote 是否存在，输入 GitService，输出健康检查项。
async function checkOriginRemote(git) {
  const remoteUrl = await git.getRemoteUrl('origin')
  if (!remoteUrl) {
    return buildCheck('git.origin', 'warn', 'origin remote 未配置', '当前仓库没有 origin remote。', '需要 push 或远程合并前，请先配置 git remote add origin <url>。')
  }

  return buildCheck('git.origin', 'pass', 'origin remote 已配置', remoteUrl)
}

// 检查 hook 配置，输入 git context，输出健康检查项。
function checkHooks(context) {
  if (context.hasHuskyFolder || context.hasHookPath) {
    return buildCheck('git.hooks', 'pass', 'Git hooks 已检测到', `hookPath=${context.hookPath}`)
  }

  return buildCheck('git.hooks', 'warn', '未检测到 Git hooks', '当前仓库没有 .husky 目录或 hooksPath。', '如团队依赖 commitlint/lint-staged，建议补齐 hooks 配置。')
}

// 检查 AI profile 配置，输入 AI 配置对象，输出健康检查项。
function checkAiProfile(aiConfig) {
  const profileCount = Object.keys(aiConfig.profiles || {}).length
  if (!profileCount || !aiConfig.activeProfile) {
    return buildCheck('ai.profile', 'warn', 'AI profile 未配置', '当前没有可用 AI profile。', '如需使用 ai commit/codereview/explain，请执行 icode config ai set ... --activate。')
  }

  return buildCheck('ai.profile', 'pass', 'AI profile 已配置', `activeProfile=${aiConfig.activeProfile}, profileCount=${profileCount}`)
}

// 检查远程合并平台配置，输入平台配置与仓库策略，输出健康检查项。
function checkRemoteMerge(remoteMergePlatform, repoPolicy) {
  const remoteMergePolicy = repoPolicy.remoteMerge && typeof repoPolicy.remoteMerge === 'object'
    ? repoPolicy.remoteMerge
    : {}

  if (remoteMergePolicy.enabled === false) {
    return buildCheck('remoteMerge.config', 'pass', '远程合并已在仓库禁用', 'repositories.<repo>.remoteMerge.enabled=false')
  }

  if (!remoteMergePlatform.provider || !remoteMergePlatform.apiKey) {
    return buildCheck('remoteMerge.config', 'warn', '远程合并平台未完整配置', '缺少 provider 或 apiKey。', '如需 icode push -r，请执行 icode config platform remote-merge set --provider gitlab --api-key <key>。')
  }

  return buildCheck('remoteMerge.config', 'pass', '远程合并平台已配置', `provider=${remoteMergePlatform.provider}`)
}

// 执行项目健康检查，输入仓库选项，输出 context、checks 和 summary。
export async function runDoctorWorkflow(options = {}) {
  const context = await resolveGitContext({
    cwd: options.cwd,
    repoMode: options.repoMode
  })
  const git = new GitService(context)
  const repoPolicy = getRepoPolicy(context.topLevelPath)
  const aiConfig = getAiConfig()
  const remoteMergePlatform = getPlatformConfig('remoteMerge')

  const checks = [
    await checkGitVersion(context.topLevelPath),
    await checkOriginRemote(git),
    checkHooks(context),
    checkAiProfile(aiConfig),
    checkRemoteMerge(remoteMergePlatform, repoPolicy)
  ]

  return {
    configPath: getConfigFilePath(),
    context,
    checks,
    summary: summarizeChecks(checks)
  }
}
