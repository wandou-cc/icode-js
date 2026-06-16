import { parseArgs } from 'node:util'
import { normalizeLegacyArgs } from '../core/cli/args.js'
import { logger } from '../core/tools/logger.js'
import { withSpinner } from '../core/tools/loading.js'
import { runReadyWorkflow } from '../workflows/ready-workflow.js'

/**
 * 输出 ready 子命令帮助。
 * 输入为空，输出标准帮助文本。
 */
function printHelp() {
  process.stdout.write(`
Usage:
  icode ready [options]

Options:
  --repo-mode <mode>     仓库模式: auto(自动继承父仓库) | strict(禁止继承)
  --json                 输出机器可读 JSON，适合 AI agent 或脚本消费
  -h, --help             查看帮助

Notes:
  ready 用于判断当前仓库是否适合继续 save/push/remote-merge，不会修改 Git 状态。
`)
}

/**
 * 根据检查状态选择彩色输出函数。
 * 输入为 pass/warn/fail，输出 logger 方法。
 */
function resolveLogMethod(status) {
  if (status === 'fail') {
    return logger.error
  }
  if (status === 'warn') {
    return logger.warn
  }
  return logger.success
}

/**
 * 输出单条 ready 检查结果。
 * 输入为检查项，输出彩色日志和下一步建议。
 */
function printCheck(check) {
  const log = resolveLogMethod(check.status).bind(logger)
  const statusLabel = check.status.toUpperCase()
  log(`[${statusLabel}] ${check.title}: ${check.detail}`)
  if (check.nextStep) {
    logger.info(`下一步: ${check.nextStep}`)
  }
}

/**
 * 输出 ready 的人类可读摘要。
 * 输入为 workflow 返回结果，输出分色日志。
 */
function printReadyResult(result) {
  const branchText = logger.color('green', result.context.currentBranch || 'DETACHED')
  const statusColor = result.status === 'fail' ? 'red' : result.status === 'warn' ? 'yellow' : 'green'
  const statusText = logger.color(statusColor, result.status.toUpperCase())

  logger.info(`仓库根目录: ${result.context.topLevelPath}`)
  logger.info(`当前分支: ${branchText}`)
  logger.info(`整体状态: ${statusText}`)
  logger.info(`改动统计: staged=${result.changes.staged}, unstaged=${result.changes.unstaged}, untracked=${result.changes.untracked}, conflicted=${result.changes.conflicted}`)

  if (result.upstream.configured) {
    logger.info(`upstream: ${result.upstream.upstream} (ahead=${result.upstream.ahead}, behind=${result.upstream.behind})`)
  } else {
    logger.warn('upstream: 未配置')
  }

  result.checks.forEach((check) => {
    printCheck(check)
  })
}

/**
 * 执行 ready 子命令。
 * 输入为原始参数，输出 ready workflow 结果；关键假设是该命令只读，不产生 Git 副作用。
 */
export async function runReadyCommand(rawArgs) {
  const args = normalizeLegacyArgs(rawArgs)
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      'repo-mode': { type: 'string', default: 'auto' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false }
    }
  })

  if (parsed.values.help) {
    printHelp()
    return
  }

  const result = await withSpinner('检查仓库就绪状态', () => runReadyWorkflow({
    repoMode: parsed.values['repo-mode']
  }))

  if (parsed.values.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return result
  }

  printReadyResult(result)
  return result
}
