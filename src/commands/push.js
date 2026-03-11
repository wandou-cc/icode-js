import { parseArgs } from 'node:util'
import { normalizeLegacyArgs } from '../core/args.js'
import { getAiCommandOptions } from '../core/ai-config.js'
import { logger } from '../core/logger.js'
import { runPushWorkflow } from '../workflows/push-workflow.js'

function formatBranchStatus(status) {
  const map = {
    pushed: '已推送',
    'merged-and-pushed': '已合并并推送',
    'remote-merged': '已远程合并',
    'remote-rebased-and-pushed': '已 rebase 后推送',
    'skipped-protected': '已跳过(受保护)',
    'skipped-missing-remote': '已跳过(远程分支不存在)',
    'remote-merge-rejected': '远程合并被拒绝',
    'remote-merge-denied': '远程合并无权限',
    'remote-merge-failed': '远程合并失败',
    'remote-rebase-conflicted': 'rebase 冲突，未推送'
  }

  return map[status] || status
}

function printHelp() {
  process.stdout.write(`
Usage:
  icode push [targetBranch...] [options]

Arguments:
  [targetBranch...]      目标分支列表（可多个，空则默认当前分支）

Options:
  -m, --message <msg>         提交信息（未填会提示输入）
  -y, --yes                   自动确认（跳过确认提示）
  -o, --origin                使用远程 rebase 推送模式
  --local-merge               使用本地 merge 模式（默认，会切换分支并生成 merge commit）
  --ai-commit                 push 前自动执行 AI commit（会参考本地 hook/commitlint 规范）
  --ai-profile <name>         指定 AI profile（用于 --ai-commit）
  --pull-main                 提交前将主分支同步到当前分支
  --not-push-current          不推送当前分支，只处理目标分支
  --force-protected           强制处理配置里的受保护分支
  --repo-mode <mode>          仓库模式: auto(自动继承父仓库) | strict(禁止继承)
  --no-verify                 跳过 hook/husky 校验
  -h, --help                  查看帮助

Notes:
  默认使用本地 merge 模式；传入 --origin 才启用远程 rebase 推送模式。
  未指定 target 时默认处理当前分支。
  布尔开关仅在命令行显式传入时生效（如 --ai-commit / --pull-main / --no-verify / -y）。
`)
}

function resolveBooleanOption(cliValue, fallback = false) {
  if (typeof cliValue === 'boolean') {
    return cliValue
  }
  if (typeof cliValue === 'string') {
    const normalized = cliValue.trim().toLowerCase()
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
      return true
    }
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
      return false
    }
  }
  return fallback
}

function resolveStringOption(cliValue, configValue, fallback = '') {
  if (typeof cliValue === 'string' && cliValue.trim()) {
    return cliValue
  }
  if (typeof configValue === 'string' && configValue.trim()) {
    return configValue
  }
  return fallback
}

function parseOptionalBoolean(value) {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
      return true
    }
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
      return false
    }
  }
  return undefined
}

function resolveRemoteMergeMode(cliValues) {
  const cliLocalMerge = parseOptionalBoolean(cliValues['local-merge'])
  if (cliLocalMerge === true) {
    return false
  }

  const cliOrigin = parseOptionalBoolean(cliValues.origin)
  if (cliOrigin === true) {
    return true
  }

  return false
}

export function resolvePushWorkflowOptions(parsedValues, parsedPositionals, scopedOptions = {}) {
  return {
    targetBranches: parsedPositionals,
    message: parsedValues.message,
    // 显式传入开关才生效，避免配置项隐式开启 push 行为。
    yes: resolveBooleanOption(parsedValues.yes, false),
    remoteMerge: resolveRemoteMergeMode(parsedValues),
    aiCommit: resolveBooleanOption(parsedValues['ai-commit'], false),
    aiCommitLang: resolveStringOption(undefined, scopedOptions.aiCommitLang, 'zh'),
    aiProfile: resolveStringOption(parsedValues['ai-profile'], scopedOptions.aiProfile, ''),
    pullMain: resolveBooleanOption(parsedValues['pull-main'], false),
    notPushCurrent: resolveBooleanOption(parsedValues['not-push-current'], false),
    forceProtected: resolveBooleanOption(parsedValues['force-protected'], false),
    repoMode: resolveStringOption(parsedValues['repo-mode'], undefined, 'auto'),
    noVerify: resolveBooleanOption(parsedValues['no-verify'], false)
  }
}

export async function runPushCommand(rawArgs) {
  const args = normalizeLegacyArgs(rawArgs)
  const scopedOptions = getAiCommandOptions('push')
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      message: { type: 'string', short: 'm' },
      yes: { type: 'boolean', short: 'y' },
      origin: { type: 'boolean', short: 'o' },
      'local-merge': { type: 'boolean' },
      'ai-commit': { type: 'boolean' },
      'ai-profile': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      'pull-main': { type: 'boolean' },
      'not-push-current': { type: 'boolean' },
      'force-protected': { type: 'boolean' },
      'repo-mode': { type: 'string' },
      'no-verify': { type: 'boolean' }
    }
  })

  if (parsed.values.help) {
    printHelp()
    return
  }

  const result = await runPushWorkflow(resolvePushWorkflowOptions(parsed.values, parsed.positionals, scopedOptions))

  if (result.canceled) {
    return
  }

  result.summary.forEach((item) => {
    logger.info(`[结果] ${item.branch}: ${formatBranchStatus(item.status)}`)
  })
  logger.success(`push 完成，共处理 ${result.summary.length} 个分支。`)
}
