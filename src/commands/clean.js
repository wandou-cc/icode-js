import { parseArgs } from 'node:util'
import { logger } from '../core/logger.js'
import { runCleanWorkflow } from '../workflows/clean-workflow.js'

function printHelp() {
  process.stdout.write(`
Usage:
  icode clean [options]

Options:
  --merged-target <branch>   基于该分支判断“已合并”状态，默认主分支
  --keep <branch|csv>        额外保留分支，可重复使用或逗号分隔
  --remote                   同时删除远程分支
  --force                    强制删除本地分支（-D）
  -y, --yes                  自动确认（跳过确认提示）
  --repo-mode <mode>         仓库模式: auto(自动继承父仓库) | strict(禁止继承)
  -h, --help                 查看帮助

Notes:
  默认保护当前分支/主分支/受保护分支。

Examples:
  icode clean
  icode clean --merged-target main --keep release,hotfix
  icode clean --remote --force -y
`)
}

export async function runCleanCommand(rawArgs) {
  const parsed = parseArgs({
    args: rawArgs,
    allowPositionals: true,
    options: {
      'merged-target': { type: 'string' },
      keep: { type: 'string', multiple: true, default: [] },
      remote: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      yes: { type: 'boolean', short: 'y', default: false },
      'repo-mode': { type: 'string', default: 'auto' },
      help: { type: 'boolean', short: 'h', default: false }
    }
  })

  if (parsed.values.help) {
    printHelp()
    return
  }

  const result = await runCleanWorkflow({
    mergedTarget: parsed.values['merged-target'],
    keep: parsed.values.keep,
    remote: parsed.values.remote,
    force: parsed.values.force,
    yes: parsed.values.yes,
    repoMode: parsed.values['repo-mode']
  })

  if (result.canceled) {
    return
  }

  logger.success(
    `clean 完成: 本地删除 ${result.deletedLocal.length} 个, 远程删除 ${result.deletedRemote.length} 个`
  )
}
