import { parseArgs } from 'node:util'
import { logger } from '../core/logger.js'
import { runUndoWorkflow } from '../workflows/undo-workflow.js'

function printHelp() {
  process.stdout.write(`
Usage:
  icode undo [options]

Options:
  --mode <mode>          回滚模式: revert | soft | mixed | hard
  --ref <ref>            回滚目标，默认按 mode 自动给出
  --recover <action>     冲突恢复策略: continue | abort | keep
  -y, --yes              自动确认（跳过确认提示）
  --repo-mode <mode>     仓库模式: auto(自动继承父仓库) | strict(禁止继承)
  -h, --help             查看帮助

Notes:
  revert 模式会生成新提交；reset 模式会移动 HEAD。

Examples:
  icode undo
  icode undo --mode revert --ref HEAD~2
  icode undo --recover abort
  icode undo --mode hard --ref HEAD~1 -y
`)
}

export async function runUndoCommand(rawArgs) {
  const parsed = parseArgs({
    args: rawArgs,
    allowPositionals: true,
    options: {
      mode: { type: 'string' },
      ref: { type: 'string' },
      recover: { type: 'string' },
      yes: { type: 'boolean', short: 'y', default: false },
      'repo-mode': { type: 'string', default: 'auto' },
      help: { type: 'boolean', short: 'h', default: false }
    }
  })

  if (parsed.values.help) {
    printHelp()
    return
  }

  const result = await runUndoWorkflow({
    mode: parsed.values.mode,
    ref: parsed.values.ref,
    recover: parsed.values.recover,
    yes: parsed.values.yes,
    repoMode: parsed.values['repo-mode']
  })

  if (result.canceled) {
    return
  }

  if (result.resolvedOperation) {
    logger.success(`undo 已处理未完成操作: ${result.resolvedOperation} -> ${result.recoverAction}`)
    return
  }

  logger.success(`undo 完成: mode=${result.mode}, ref=${result.ref}`)
}
