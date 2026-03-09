import { parseArgs } from 'node:util'
import { normalizeLegacyArgs } from '../core/args.js'
import { logger } from '../core/logger.js'
import { runRollbackWorkflow } from '../workflows/rollback-workflow.js'

function printHelp() {
  process.stdout.write(`
Usage:
  icode rollback [ref] [options]

Options:
  --mode <mode>          revert | soft | mixed | hard (默认: revert)
  -y, --yes              自动确认（hard 模式建议显式传入）
  --repo-mode <mode>     仓库模式: auto | strict
  -h, --help             查看帮助

Examples:
  icode rollback HEAD~1
  icode rollback HEAD~2 --mode soft
  icode rollback HEAD~1 --mode hard -y
`)
}

export async function runRollbackCommand(rawArgs) {
  const args = normalizeLegacyArgs(rawArgs)
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      mode: { type: 'string', default: 'revert' },
      yes: { type: 'boolean', short: 'y', default: false },
      'repo-mode': { type: 'string', default: 'auto' },
      help: { type: 'boolean', short: 'h', default: false }
    }
  })

  if (parsed.values.help) {
    printHelp()
    return
  }

  const [ref] = parsed.positionals

  const result = await runRollbackWorkflow({
    ref,
    mode: parsed.values.mode,
    yes: parsed.values.yes,
    repoMode: parsed.values['repo-mode']
  })

  if (result.canceled) {
    return
  }

  logger.success(`rollback 完成: mode=${result.mode}, ref=${result.ref}`)
}
