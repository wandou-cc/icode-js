import { parseArgs } from 'node:util'
import { normalizeLegacyArgs } from '../core/args.js'
import { getAiCommandOptions } from '../core/ai-config.js'
import { IcodeError } from '../core/errors.js'
import { logger } from '../core/logger.js'
import { runAiCodeReviewWorkflow } from '../workflows/ai-codereview-workflow.js'
import { runAiCommitWorkflow } from '../workflows/ai-commit-workflow.js'
import { runAiConflictWorkflow } from '../workflows/ai-conflict-workflow.js'

function printMainHelp() {
  process.stdout.write(`
Usage:
  icode ai <subcommand> [options]

Subcommands:
  commit        AI 生成提交信息
  conflict      AI 冲突解决建议
  codereview    AI 代码评审

Tips:
  icode ai <subcommand> -h  查看子命令参数说明

Examples:
  icode ai commit --apply -y
  icode ai conflict
  icode ai codereview --base origin/main --head HEAD
`)
}

function printCommitHelp() {
  process.stdout.write(`
Usage:
  icode ai commit [options]

Options:
  --apply                 直接使用 AI 信息执行 commit
  --lang <zh|en>          输出语言，默认 zh
  --profile <name>        指定 AI profile
  --repo-mode <mode>      仓库模式: auto(自动继承父仓库) | strict(禁止继承)
  --no-verify             commit 时跳过 hook/husky 校验
  -y, --yes               自动确认（跳过确认提示）
  -h, --help              查看帮助
`)
}

function printConflictHelp() {
  process.stdout.write(`
Usage:
  icode ai conflict [options]

Options:
  --profile <name>        指定 AI profile
  --repo-mode <mode>      仓库模式: auto(自动继承父仓库) | strict(禁止继承)
  -h, --help              查看帮助
`)
}

function printCodeReviewHelp() {
  process.stdout.write(`
Usage:
  icode ai codereview [options]

Options:
  --base <ref>            diff 基线，默认 origin/<defaultBranch>
  --head <ref>            diff 终点，默认 HEAD
  --focus <text>          评审重点（安全/性能/测试等）
  --profile <name>        指定 AI profile
  --repo-mode <mode>      仓库模式: auto(自动继承父仓库) | strict(禁止继承)
  --dump-response         输出 AI 原始响应（调试数据格式）
  -h, --help              查看帮助
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

async function runCommitSubcommand(rawArgs) {
  const scopedOptions = getAiCommandOptions('commit')
  const parsed = parseArgs({
    args: rawArgs,
    allowPositionals: true,
    options: {
      apply: { type: 'boolean' },
      lang: { type: 'string' },
      profile: { type: 'string' },
      'repo-mode': { type: 'string' },
      'no-verify': { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
      help: { type: 'boolean', short: 'h' }
    }
  })

  if (parsed.values.help) {
    printCommitHelp()
    return
  }

  const result = await runAiCommitWorkflow({
    apply: resolveBooleanOption(parsed.values.apply, scopedOptions.apply, false),
    lang: resolveStringOption(parsed.values.lang, scopedOptions.lang, 'zh'),
    profile: resolveStringOption(parsed.values.profile, scopedOptions.profile, ''),
    repoMode: resolveStringOption(parsed.values['repo-mode'], scopedOptions.repoMode, 'auto'),
    noVerify: resolveBooleanOption(parsed.values['no-verify'], scopedOptions.noVerify, false),
    yes: resolveBooleanOption(parsed.values.yes, scopedOptions.yes, false)
  })

  if (result.canceled) {
    return
  }

  if (result.applied) {
    logger.success(`AI commit 已应用: ${result.commitMessage.split('\n')[0]}`)
  }
}

async function runConflictSubcommand(rawArgs) {
  const scopedOptions = getAiCommandOptions('conflict')
  const parsed = parseArgs({
    args: rawArgs,
    allowPositionals: true,
    options: {
      profile: { type: 'string' },
      'repo-mode': { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    }
  })

  if (parsed.values.help) {
    printConflictHelp()
    return
  }

  const result = await runAiConflictWorkflow({
    profile: resolveStringOption(parsed.values.profile, scopedOptions.profile, ''),
    repoMode: resolveStringOption(parsed.values['repo-mode'], scopedOptions.repoMode, 'auto')
  })

  logger.info(`冲突文件: ${result.conflictedFiles.join(', ')}`)
  process.stdout.write(`\n${result.suggestion}\n`)
}

async function runCodeReviewSubcommand(rawArgs) {
  const scopedOptions = getAiCommandOptions('codereview')
  const parsed = parseArgs({
    args: rawArgs,
    allowPositionals: true,
    options: {
      base: { type: 'string' },
      head: { type: 'string' },
      focus: { type: 'string' },
      profile: { type: 'string' },
      'repo-mode': { type: 'string' },
      'dump-response': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    }
  })

  if (parsed.values.help) {
    printCodeReviewHelp()
    return
  }

  const result = await runAiCodeReviewWorkflow({
    baseRef: resolveStringOption(parsed.values.base, scopedOptions.base, ''),
    headRef: resolveStringOption(parsed.values.head, scopedOptions.head, ''),
    focus: resolveStringOption(parsed.values.focus, scopedOptions.focus, ''),
    profile: resolveStringOption(parsed.values.profile, scopedOptions.profile, ''),
    repoMode: resolveStringOption(parsed.values['repo-mode'], scopedOptions.repoMode, 'auto'),
    dumpResponse: resolveBooleanOption(parsed.values['dump-response'], scopedOptions.dumpResponse, false)
  })

  logger.info(`Code Review 范围: ${result.rangeSpec}`)
  process.stdout.write(`\n${result.review}\n`)
}

export async function runAiCommand(rawArgs) {
  const args = normalizeLegacyArgs(rawArgs)

  if (!args.length || args[0] === '--help' || args[0] === '-h') {
    printMainHelp()
    return
  }

  const [subcommand, ...subcommandArgs] = args

  if (subcommand === 'commit') {
    await runCommitSubcommand(subcommandArgs)
    return
  }

  if (subcommand === 'conflict') {
    await runConflictSubcommand(subcommandArgs)
    return
  }

  if (subcommand === 'codereview' || subcommand === 'review') {
    await runCodeReviewSubcommand(subcommandArgs)
    return
  }

  throw new IcodeError(`未知 ai 子命令: ${subcommand}`, {
    code: 'AI_SUBCOMMAND_UNKNOWN',
    exitCode: 2
  })
}
