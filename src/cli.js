import { runAiCommand } from './commands/ai.js'
import { runCleanCommand } from './commands/clean.js'
import { runCodeReviewCommand } from './commands/codereview.js'
import { runCompletionCommand, runHiddenCompletionCommand } from './commands/completion.js'
import { runCheckoutCommand } from './commands/checkout.js'
import { runConfigCommand } from './commands/config.js'
import { runDoctorCommand } from './commands/doctor.js'
import { runExplainCommand } from './commands/explain.js'
import { printMainHelp } from './commands/help.js'
import { runInfoCommand } from './commands/info.js'
import { runMigrateCommand } from './commands/migrate.js'
import { runPushCommand } from './commands/push.js'
import { runReadyCommand } from './commands/ready.js'
import { runSaveCommand } from './commands/save.js'
import { runSyncCommand } from './commands/sync.js'
import { runTagCommand } from './commands/tag.js'
import { runUndoCommand } from './commands/undo.js'
import { asIcodeError, IcodeError } from './core/errors.js'
import { normalizeLegacyArgs } from './core/cli/args.js'
import { notifyIfCliUpdateAvailable } from './core/cli/update-notifier.js'
import { logger } from './core/tools/logger.js'

function isTruthy(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized)
}

function redactSensitiveMeta(value, seen = new WeakSet()) {
  if (typeof value === 'string') {
    return value
      .replace(/(Bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
      .replace(/((?:api[_-]?key|private[_-]?token|authorization)\s*[=:]\s*)[^\s,;"']+/gi, '$1[REDACTED]')
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  if (seen.has(value)) {
    return '[Circular]'
  }

  seen.add(value)
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveMeta(item, seen))
  }

  const sanitized = {}
  for (const [key, item] of Object.entries(value)) {
    sanitized[key] = /api[_-]?key|token|authorization|secret|password/i.test(key)
      ? '[REDACTED]'
      : redactSensitiveMeta(item, seen)
  }
  return sanitized
}

function serializeErrorMeta(meta) {
  try {
    return JSON.stringify(redactSensitiveMeta(meta), null, 2)
  } catch {
    return '[无法序列化错误详情]'
  }
}

const COMMANDS = {
  ai: runAiCommand,
  codereview: runCodeReviewCommand,
  completion: runCompletionCommand,
  checkout: runCheckoutCommand,
  ready: runReadyCommand,
  save: runSaveCommand,
  push: runPushCommand,
  sync: runSyncCommand,
  clean: runCleanCommand,
  undo: runUndoCommand,
  migrate: runMigrateCommand,
  tag: runTagCommand,
  config: runConfigCommand,
  doctor: runDoctorCommand,
  explain: runExplainCommand,
  info: runInfoCommand,
  help: async () => {
    printMainHelp()
  },
  __complete: runHiddenCompletionCommand
}

const NO_UPDATE_NOTIFICATION_COMMANDS = new Set(['help', 'completion', '__complete'])

/**
 * 执行 CLI 主流程并在命令成功后触发升级提示检查。
 * 输入为命令行参数与可注入依赖，输出为建议的退出码。
 */
export async function runCli(argv = process.argv.slice(2), dependencies = {}) {
  const commands = dependencies.commands || COMMANDS
  const printHelp = dependencies.printMainHelp || printMainHelp
  const notifyUpdate = dependencies.notifyIfCliUpdateAvailable || notifyIfCliUpdateAvailable
  const { globalArgs, commandName, commandArgs } = parseEntryArgs(argv)
  const globalResult = applyGlobalFlags(globalArgs)

  if (globalResult.shouldExit) {
    return globalResult.exitCode
  }

  if (!commandName) {
    printHelp()
    return 0
  }

  const command = commands[commandName]
  if (!command) {
    throw new IcodeError(`未知命令: ${commandName}`, {
      code: 'CLI_UNKNOWN_COMMAND',
      exitCode: 2,
      meta: { commandName }
    })
  }

  await command(commandArgs)

  if (!NO_UPDATE_NOTIFICATION_COMMANDS.has(commandName)) {
    await notifyUpdate()
  }

  return 0
}

function parseEntryArgs(argv) {
  const args = normalizeLegacyArgs(argv)
  const firstCommandIndex = args.findIndex((arg) => !arg.startsWith('-'))

  const globalArgs = firstCommandIndex === -1 ? args : args.slice(0, firstCommandIndex)
  const commandName = firstCommandIndex === -1 ? null : args[firstCommandIndex]
  const commandArgs = firstCommandIndex === -1 ? [] : args.slice(firstCommandIndex + 1)

  return {
    globalArgs,
    commandName,
    commandArgs
  }
}

function applyGlobalFlags(globalArgs) {
  for (const flag of globalArgs) {
    if (flag === '-d' || flag === '--debug') {
      logger.setVerbose(true)
      process.env.ICODE_DEBUG = '1'
      continue
    }

    if (flag === '-h' || flag === '--help') {
      printMainHelp()
      return {
        shouldExit: true,
        exitCode: 0
      }
    }

    throw new IcodeError(`未知全局参数: ${flag}`, {
      code: 'CLI_UNKNOWN_GLOBAL_FLAG',
      exitCode: 2,
      meta: { flag }
    })
  }

  return {
    shouldExit: false,
    exitCode: 0
  }
}

/**
 * 启动 CLI 入口，复用 runCli 处理参数与命令调度。
 * 输入为可选 argv 与依赖注入，输出为退出码。
 */
export async function main(argv = process.argv.slice(2), dependencies = {}) {
  return runCli(argv, dependencies)
}

/**
 * 统一处理 CLI 异常并输出对用户可读的错误信息。
 * 输入为任意异常对象，输出为进程退出。
 */
export function handleCliError(error) {
  const normalized = asIcodeError(error)
  logger.error(normalized.message)

  if (normalized.code === 'AI_EMPTY_RESPONSE') {
    if (normalized.meta?.thinkingPreview) {
      logger.warn('检测到模型返回了思考过程，但没有可展示的最终内容。默认不会输出思考过程。')
    }
    if (normalized.meta?.hint) {
      logger.warn(normalized.meta.hint)
    }
    if (normalized.meta?.rawResponse) {
      logger.warn('如需排查原始响应，请使用 `--dump-response` 或设置 `ICODE_AI_DUMP_RESPONSE=1`。')
    }
  }

  if ((process.env.ICODE_DEBUG === '1' || isTruthy(process.env.ICODE_AI_DUMP_RESPONSE)) && normalized.meta && Object.keys(normalized.meta).length) {
    process.stderr.write(`[icode:debug] error meta:\n${serializeErrorMeta(normalized.meta)}\n`)
  }

  process.exit(normalized.exitCode || 1)
}
