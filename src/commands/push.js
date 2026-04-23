import { parseArgs } from 'node:util'
import { getAiCommandOptions } from '../core/ai/config.js'
import { normalizeLegacyArgs } from '../core/cli/args.js'
import { logger } from '../core/tools/logger.js'
import { runPushWorkflow } from '../workflows/push-workflow.js'

const PUSH_PARSE_OPTIONS = {
  message: { type: 'string', short: 'm' },
  yes: { type: 'boolean', short: 'y' },
  'local-merge': { type: 'boolean' },
  'remote-merge': { type: 'boolean', short: 'r' },
  'ai-commit': { type: 'boolean' },
  'ai-profile': { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  'pull-main': { type: 'boolean' },
  'not-push-current': { type: 'boolean' },
  'force-protected': { type: 'boolean' },
  'repo-mode': { type: 'string' },
  'no-verify': { type: 'boolean' }
}

function formatBranchStatus(status) {
  const map = {
    pushed: '已推送',
    'merged-and-pushed': '已合并并推送',
    'remote-merged-and-pushed': '已远程合并并推送',
    'skipped-protected': '已跳过(受保护)',
    'skipped-missing-remote': '已跳过(远程分支不存在)',
    paused: '已暂停'
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
  --local-merge               使用本地 merge 模式（默认，会切换分支并生成 merge commit）
  -r, --remote-merge          使用远程 PR/MR 合并模式（默认启用项目远程合并）
  --ai-commit                 push 前自动执行 AI commit（会参考本地 hook/commitlint 规范）
  --ai-profile <name>         指定 AI profile（用于 --ai-commit）
  --pull-main                 提交前将主分支同步到当前分支
  --not-push-current          不推送当前分支，只处理目标分支
  --force-protected           强制处理配置里的受保护分支
  --repo-mode <mode>          仓库模式: auto(自动继承父仓库) | strict(禁止继承)
  --no-verify                 跳过 hook/husky 校验
  -h, --help                  查看帮助

Notes:
  默认使用本地 merge 模式。
  未指定 target 时默认处理当前分支。
  远程 merge 通过 PR/MR API 发起，不会本地切换到目标分支。
  远程 merge 若出现冲突会暂停流程，并保留明确失败原因。
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

// 统一输出 push 结果摘要，失败分支会追加具体原因，方便定位问题目标分支。
function printPushSummary(summary = []) {
  summary.forEach((item) => {
    const reason = typeof item.reason === 'string' && item.reason.trim() ? ` - ${item.reason.trim()}` : ''
    logger.info(`[结果] ${item.branch}: ${formatBranchStatus(item.status)}${reason}`)
  })
}

export function resolvePushWorkflowOptions(parsedValues, parsedPositionals, scopedOptions = {}) {
  return {
    targetBranches: parsedPositionals,
    message: parsedValues.message,
    // 显式传入开关才生效，避免配置项隐式开启 push 行为。
    yes: resolveBooleanOption(parsedValues.yes, false),
    remoteMerge: resolveBooleanOption(parsedValues['remote-merge'], false),
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

// 解析 push 子命令参数；rawArgs 是不含命令名的参数数组，返回 node:util parseArgs 的结构化结果。
export function parsePushCommandArgs(rawArgs) {
  const args = normalizeLegacyArgs(rawArgs)
  return parseArgs({
    args,
    allowPositionals: true,
    options: PUSH_PARSE_OPTIONS
  })
}

// 执行 push 子命令；rawArgs 是不含命令名的参数数组，输出结果摘要并保留 workflow 抛出的失败信息。
export async function runPushCommand(rawArgs) {
  const scopedOptions = getAiCommandOptions('push')
  const parsed = parsePushCommandArgs(rawArgs)

  if (parsed.values.help) {
    printHelp()
    return
  }

  let result
  try {
    result = await runPushWorkflow(resolvePushWorkflowOptions(parsed.values, parsed.positionals, scopedOptions))
  } catch (error) {
    if (Array.isArray(error?.meta?.summary) && error.meta.summary.length) {
      printPushSummary(error.meta.summary)
    }
    throw error
  }

  if (result.canceled) {
    return
  }

  printPushSummary(result.summary)
  logger.success(`push 完成，共处理 ${result.summary.length} 个分支。`)
}
