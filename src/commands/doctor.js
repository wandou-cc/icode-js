import { parseArgs } from 'node:util'
import { normalizeLegacyArgs } from '../core/cli/args.js'
import { logger } from '../core/tools/logger.js'
import { runDoctorWorkflow } from '../workflows/doctor-workflow.js'

// 输出 doctor 子命令帮助，输入为空，输出标准帮助文本。
function printHelp() {
  process.stdout.write(`
Usage:
  icode doctor [options]

Options:
  --repo-mode <mode>     仓库模式: auto(自动继承父仓库) | strict(禁止继承)
  --json                 输出机器可读 JSON
  -h, --help             查看帮助

Notes:
  检查 Git、origin、hooks、AI profile 与远程合并配置，并给出修复建议。
`)
}

// 根据检查状态选择输出函数，输入状态，输出 logger 方法。
function resolveLogMethod(status) {
  if (status === 'fail') {
    return logger.error
  }
  if (status === 'warn') {
    return logger.warn
  }
  return logger.success
}

// 输出单条 doctor 检查结果，输入检查项，输出彩色日志。
function printCheck(check) {
  const log = resolveLogMethod(check.status).bind(logger)
  const statusLabel = check.status.toUpperCase()
  log(`[${statusLabel}] ${check.title}: ${check.detail}`)
  if (check.suggestion) {
    logger.info(`建议: ${check.suggestion}`)
  }
}

// 执行 doctor 子命令，输入原始参数，输出健康检查结果。
// 执行 doctor 子命令，输入原始参数，输出健康检查结果；参数会先归一化。
export async function runDoctorCommand(rawArgs) {
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

  const result = await runDoctorWorkflow({
    repoMode: parsed.values['repo-mode']
  })

  if (parsed.values.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return result
  }

  logger.info(`仓库根目录: ${result.context.topLevelPath}`)
  logger.info(`配置文件: ${result.configPath}`)
  result.checks.forEach((check) => {
    printCheck(check)
  })

  const summary = result.summary
  logger.info(`doctor 完成: pass=${summary.pass}, warn=${summary.warn}, fail=${summary.fail}`)
  return result
}
