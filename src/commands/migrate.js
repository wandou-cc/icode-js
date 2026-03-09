import { parseArgs } from 'node:util'
import { normalizeLegacyArgs } from '../core/args.js'
import { logger } from '../core/logger.js'
import { runMigrateWorkflow } from '../workflows/migrate-workflow.js'

function printHelp() {
  process.stdout.write(`
Usage:
  icode migrate <sourceBranch> <targetBranch> [options]

Options:
  --range <spec>         指定提交范围，例如 main..feature-x
  --push                 迁移后自动推送 target 分支
  -y, --yes              自动确认
  --repo-mode <mode>     仓库模式: auto | strict
  --no-verify            推送时跳过 hook/husky 校验
  -h, --help             查看帮助

Examples:
  icode migrate feature/login release
  icode migrate feature/login release --range HEAD~3..feature/login
  icode migrate feature/login release --push -y
`)
}

export async function runMigrateCommand(rawArgs) {
  const args = normalizeLegacyArgs(rawArgs)
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      range: { type: 'string' },
      push: { type: 'boolean', default: false },
      yes: { type: 'boolean', short: 'y', default: false },
      'repo-mode': { type: 'string', default: 'auto' },
      'no-verify': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false }
    }
  })

  if (parsed.values.help || parsed.positionals.length < 2) {
    printHelp()
    return
  }

  const [sourceBranch, targetBranch] = parsed.positionals

  const result = await runMigrateWorkflow({
    sourceBranch,
    targetBranch,
    range: parsed.values.range,
    push: parsed.values.push,
    yes: parsed.values.yes,
    repoMode: parsed.values['repo-mode'],
    noVerify: parsed.values['no-verify']
  })

  if (result.canceled) {
    return
  }

  logger.success(
    `migrate 完成: ${result.sourceBranch} -> ${result.targetBranch}, commits=${result.migratedCommits}`
  )
}
