import { parseArgs } from 'node:util'
import { normalizeLegacyArgs } from '../core/args.js'
import { logger } from '../core/logger.js'
import { runSyncWorkflow } from '../workflows/sync-workflow.js'

function printHelp() {
  process.stdout.write(`
Usage:
  icode sync [branch...] [options]

Arguments:
  [branch...]             需要同步的分支列表（可多个）

Options:
  --all-local             自动同步全部本地分支
  --merge-main            同步后把主分支 merge 到目标分支
  --rebase                pull 时使用 rebase
  --push                  同步后自动 push
  -y, --yes               自动确认（跳过确认提示）
  --repo-mode <mode>      仓库模式: auto(自动继承父仓库) | strict(禁止继承)
  --no-verify             push 时跳过 hook/husky 校验
  -h, --help              查看帮助

Notes:
  未传分支时默认同步当前分支与主分支。

Examples:
  icode sync
  icode sync --all-local
  icode sync develop test --merge-main
  icode sync release --push -y
`)
}

export async function runSyncCommand(rawArgs) {
  const args = normalizeLegacyArgs(rawArgs)
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      'all-local': { type: 'boolean', default: false },
      'merge-main': { type: 'boolean', default: false },
      rebase: { type: 'boolean', default: false },
      push: { type: 'boolean', default: false },
      yes: { type: 'boolean', short: 'y', default: false },
      'repo-mode': { type: 'string', default: 'auto' },
      'no-verify': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false }
    }
  })

  if (parsed.values.help) {
    printHelp()
    return
  }

  const result = await runSyncWorkflow({
    branches: parsed.positionals,
    allLocal: parsed.values['all-local'],
    mergeMain: parsed.values['merge-main'],
    rebase: parsed.values.rebase,
    push: parsed.values.push,
    yes: parsed.values.yes,
    repoMode: parsed.values['repo-mode'],
    noVerify: parsed.values['no-verify']
  })

  if (result.canceled) {
    return
  }

  const summaryText = result.summary.map((item) => `${item.branch}:${item.status}`).join(', ')
  logger.success(`sync 完成: ${summaryText}`)
}
