import { runAiCommand } from './commands/ai.js'
import { runCleanCommand } from './commands/clean.js'
import { runCodeReviewCommand } from './commands/codereview.js'
import { runCheckoutCommand } from './commands/checkout.js'
import { runConfigCommand } from './commands/config.js'
import { printMainHelp } from './commands/help.js'
import { runInfoCommand } from './commands/info.js'
import { runMigrateCommand } from './commands/migrate.js'
import { runPushCommand } from './commands/push.js'
import { runSyncCommand } from './commands/sync.js'
import { runTagCommand } from './commands/tag.js'
import { runUndoCommand } from './commands/undo.js'
import { asIcodeError } from './core/errors.js'
import { logger } from './core/logger.js'
import { normalizeLegacyArgs } from './core/args.js'

function isTruthy(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized)
}

function serializeErrorMeta(meta) {
  try {
    return JSON.stringify(meta, null, 2)
  } catch {
    return String(meta)
  }
}

const COMMANDS = {
  ai: runAiCommand,
  codereview: runCodeReviewCommand,
  checkout: runCheckoutCommand,
  push: runPushCommand,
  sync: runSyncCommand,
  clean: runCleanCommand,
  undo: runUndoCommand,
  migrate: runMigrateCommand,
  tag: runTagCommand,
  config: runConfigCommand,
  info: runInfoCommand,
  help: async () => {
    printMainHelp()
  }
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

    throw new Error(`未知全局参数: ${flag}`)
  }

  return {
    shouldExit: false,
    exitCode: 0
  }
}

async function main() {
  const { globalArgs, commandName, commandArgs } = parseEntryArgs(process.argv.slice(2))
  const globalResult = applyGlobalFlags(globalArgs)

  if (globalResult.shouldExit) {
    process.exit(globalResult.exitCode)
  }

  if (!commandName) {
    printMainHelp()
    process.exit(0)
  }

  const command = COMMANDS[commandName]
  if (!command) {
    throw new Error(`未知命令: ${commandName}`)
  }

  await command(commandArgs)
}

main().catch((error) => {
  const normalized = asIcodeError(error)
  logger.error(normalized.message)

  if (normalized.code === 'AI_EMPTY_RESPONSE' && normalized.meta?.rawResponse) {
    logger.warn('AI 原始响应如下（用于排查响应格式）:')
    process.stderr.write(`${normalized.meta.rawResponse}\n`)
  }

  if ((process.env.ICODE_DEBUG === '1' || isTruthy(process.env.ICODE_AI_DUMP_RESPONSE)) && normalized.meta && Object.keys(normalized.meta).length) {
    process.stderr.write(`[icode:debug] error meta:\n${serializeErrorMeta(normalized.meta)}\n`)
  }

  process.exit(normalized.exitCode || 1)
})
