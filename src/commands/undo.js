import { parseArgs } from 'node:util'
import { IcodeError } from '../core/errors.js'
import { logger } from '../core/logger.js'
import { runUndoWorkflow } from '../workflows/undo-workflow.js'

/**
 * 输出 undo 命令帮助文本。
 * 输入为空，输出为标准输出文本。
 */
function printHelp() {
  process.stdout.write(`
Usage:
  icode undo [ref] [options]

Options:
  --mode <mode>          回滚模式: revert | soft | mixed | hard
  --ref <ref>            回滚目标，默认按 mode 自动给出
  --hash <hash>          按 commit hash 指定回滚目标（等同 --ref）
  --recover <action>     冲突恢复策略: continue | abort | keep
  -y, --yes              自动确认（跳过确认提示）
  --repo-mode <mode>     仓库模式: auto(自动继承父仓库) | strict(禁止继承)
  -h, --help             查看帮助

Notes:
  revert 模式会生成新提交；reset 模式会移动 HEAD。

Examples:
  icode undo
  icode undo a1b2c3d
  icode undo --mode revert --ref HEAD~2
  icode undo --mode hard --hash a1b2c3d -y
  icode undo --recover abort
  icode undo --mode hard --ref HEAD~1 -y
`)
}

/**
 * 归一化 undo 命令参数。
 * 输入为 parseArgs 的 values、positionals 与默认配置，输出为 workflow 可直接使用的显式选项。
 */
export function resolveUndoWorkflowOptions(values, positionals, defaults = {}) {
  if (positionals.length > 1) {
    throw new IcodeError('undo 最多支持一个位置参数作为回滚目标 ref/hash', {
      code: 'UNDO_POSITIONAL_INVALID',
      exitCode: 2
    })
  }

  const refCandidates = [
    { source: '--ref', value: values.ref },
    { source: '--hash', value: values.hash },
    { source: 'position', value: positionals[0] }
  ].filter((candidate) => typeof candidate.value === 'string' && candidate.value.trim())

  const normalizedRefs = refCandidates.map((candidate) => ({
    source: candidate.source,
    value: candidate.value.trim()
  }))
  const firstRef = normalizedRefs[0]?.value
  const conflict = normalizedRefs.find((candidate) => candidate.value !== firstRef)

  if (conflict) {
    throw new IcodeError(
      `undo 回滚目标冲突: ${normalizedRefs.map((item) => `${item.source}=${item.value}`).join(', ')}`,
      {
        code: 'UNDO_REF_CONFLICT',
        exitCode: 2
      }
    )
  }

  return {
    mode: values.mode,
    ref: firstRef,
    recover: values.recover,
    yes: values.yes === true,
    repoMode: values['repo-mode'] || defaults.repoMode || 'auto'
  }
}

/**
 * 执行 undo 命令。
 * 输入为子命令参数数组，输出为空；内部会按参数调用 undo workflow 并打印结果。
 */
export async function runUndoCommand(rawArgs) {
  const parsed = parseArgs({
    args: rawArgs,
    allowPositionals: true,
    options: {
      mode: { type: 'string' },
      ref: { type: 'string' },
      hash: { type: 'string' },
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

  const result = await runUndoWorkflow(resolveUndoWorkflowOptions(parsed.values, parsed.positionals))

  if (result.canceled) {
    return
  }

  if (result.resolvedOperation) {
    logger.success(`undo 已处理未完成操作: ${result.resolvedOperation} -> ${result.recoverAction}`)
    return
  }

  logger.success(`undo 完成: mode=${result.mode}, ref=${result.ref}`)
}
