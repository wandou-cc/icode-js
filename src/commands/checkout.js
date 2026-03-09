import { parseArgs } from 'node:util'
import { normalizeLegacyArgs } from '../core/args.js'
import { logger } from '../core/logger.js'
import { runCheckoutWorkflow } from '../workflows/checkout-workflow.js'

function printHelp() {
  process.stdout.write(`
Usage:
  icode checkout <branch> [base] [options]

Options:
  -y, --yes              自动确认
  --push-origin          新建分支后立即推送到 origin
  --pull-main            切换后同步主分支
  --repo-mode <mode>     仓库模式: auto | strict
  --no-verify            跳过 hook/husky 校验
  -h, --help             查看帮助
`)
}

export async function runCheckoutCommand(rawArgs) {
  const args = normalizeLegacyArgs(rawArgs)
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      yes: { type: 'boolean', short: 'y', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      'push-origin': { type: 'boolean', default: false },
      'pull-main': { type: 'boolean', default: false },
      'repo-mode': { type: 'string', default: 'auto' },
      'no-verify': { type: 'boolean', default: false }
    }
  })

  if (parsed.values.help || parsed.positionals.length < 1) {
    printHelp()
    return
  }

  const [branchName, baseBranchName] = parsed.positionals
  const result = await runCheckoutWorkflow({
    branchName,
    baseBranchName,
    pushOrigin: parsed.values['push-origin'],
    pullMain: parsed.values['pull-main'],
    repoMode: parsed.values['repo-mode'],
    noVerify: parsed.values['no-verify']
  })

  logger.success(`checkout 完成: ${result.branchName}`)
}
