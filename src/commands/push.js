import { parseArgs } from 'node:util'
import { normalizeLegacyArgs } from '../core/args.js'
import { getAiCommandOptions } from '../core/ai-config.js'
import { logger } from '../core/logger.js'
import { runPushWorkflow } from '../workflows/push-workflow.js'

function printHelp() {
  process.stdout.write(`
Usage:
  icode push [targetBranch...] [options]

Options:
  -m, --message <msg>         提交信息
  -y, --yes                   自动确认
  -o, --origin                远程合并模式（source:target）
  --ai-commit                 push 前自动执行 AI commit（生成并应用提交信息）
  --ai-review                 提交前执行 AI 风险评审
  --ai-profile <name>         指定 AI profile
  --pull-main                 提交前将主分支同步到当前分支
  --not-push-current          不推送当前分支，只处理目标分支
  --force-protected           强制处理配置里的受保护分支
  --repo-mode <mode>          仓库模式: auto | strict
  --no-verify                 跳过 hook/husky 校验
  -h, --help                  查看帮助
`)
}

function resolveBooleanOption(cliValue, configValue, fallback = false) {
  if (typeof cliValue === 'boolean') {
    return cliValue
  }
  if (typeof configValue === 'boolean') {
    return configValue
  }
  if (typeof configValue === 'string') {
    const normalized = configValue.trim().toLowerCase()
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
      'ai-commit': { type: 'boolean' },
      'ai-review': { type: 'boolean' },
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

  const result = await runPushWorkflow({
    targetBranches: parsed.positionals,
    message: parsed.values.message,
    yes: resolveBooleanOption(parsed.values.yes, scopedOptions.yes, false),
    remoteMerge: resolveBooleanOption(parsed.values.origin, scopedOptions.origin, false),
    aiCommit: resolveBooleanOption(parsed.values['ai-commit'], scopedOptions.aiCommit, false),
    aiCommitLang: resolveStringOption(undefined, scopedOptions.aiCommitLang, 'zh'),
    aiReview: resolveBooleanOption(parsed.values['ai-review'], scopedOptions.aiReview, false),
    aiProfile: resolveStringOption(parsed.values['ai-profile'], scopedOptions.aiProfile, ''),
    pullMain: resolveBooleanOption(parsed.values['pull-main'], scopedOptions.pullMain, false),
    notPushCurrent: resolveBooleanOption(parsed.values['not-push-current'], scopedOptions.notPushCurrent, false),
    forceProtected: resolveBooleanOption(parsed.values['force-protected'], scopedOptions.forceProtected, false),
    repoMode: resolveStringOption(parsed.values['repo-mode'], scopedOptions.repoMode, 'auto'),
    noVerify: resolveBooleanOption(parsed.values['no-verify'], scopedOptions.noVerify, false)
  })

  if (result.canceled) {
    return
  }

  const summaryText = result.summary.map((item) => `${item.branch}:${item.status}`).join(', ')
  logger.success(`push 完成: ${summaryText}`)
}
