import { parseArgs } from 'node:util'
import { normalizeLegacyArgs } from '../core/cli/args.js'
import { IcodeError } from '../core/errors.js'
import { logger } from '../core/tools/logger.js'
import { runMigrateWorkflow } from '../workflows/migrate-workflow.js'

function printHelp() {
  process.stdout.write(`
Usage:
  icode migrate <sourceBranch> <targetBranch> [options]
  icode migrate --interactive

Arguments:
  <sourceBranch>         迁移来源分支（交互模式可省略）
  <targetBranch>         迁移目标分支（交互模式可省略）

Options:
  -i, --interactive      交互模式（单选/多选 source/target 与迁移范围）
  --range <spec>         指定提交范围，例如 main..feature-x（交互模式下若提供则直接使用）
  --dry-run              只展示迁移计划，不 checkout/pull/cherry-pick/push
  --json                 输出机器可读 JSON，适合 AI agent 或脚本消费
  --push                 迁移后自动推送 target 分支
  -y, --yes              自动确认（跳过确认提示）
  --repo-mode <mode>     仓库模式: auto(自动继承父仓库) | strict(禁止继承)
  --no-verify            推送时跳过 hook/husky 校验
  -h, --help             查看帮助

Notes:
  默认迁移 target..source 的增量提交。

Examples:
  icode migrate feature/login release
  icode migrate --interactive
  icode migrate feature/login release --dry-run --json
  icode migrate feature/login release --range HEAD~3..feature/login
  icode migrate feature/login release --push -y
`)
}

// 输出 migrate dry-run 计划，输入 workflow 结果，输出人类可读步骤。
function printDryRunPlan(result) {
  const previewLimit = 10
  const previewCommits = result.commits.slice(0, previewLimit)

  logger.info(`[dry-run] source: ${result.sourceBranch} (${result.sourceRef})`)
  logger.info(`[dry-run] target: ${result.targetBranch} (${result.targetRef})`)
  logger.info(`[dry-run] range: ${result.rangeSpec}`)
  logger.info(`[dry-run] commits: ${result.migratedCommits}`)
  previewCommits.forEach((commit, index) => {
    logger.info(`[dry-run] commit ${index + 1}: ${commit.summary || commit.hash}`)
  })
  if (result.commits.length > previewLimit) {
    logger.info(`[dry-run] ... 还有 ${result.commits.length - previewLimit} 个提交未显示，可用 --json 查看完整计划`)
  }
  result.steps.forEach((step, index) => {
    logger.info(`[dry-run] ${index + 1}. ${step.action}: ${step.detail}`)
  })
}

export async function runMigrateCommand(rawArgs) {
  const args = normalizeLegacyArgs(rawArgs)
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      interactive: { type: 'boolean', short: 'i', default: false },
      range: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
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

  if (parsed.positionals.length > 2) {
    throw new IcodeError('参数过多: icode migrate 最多接收两个分支参数', {
      code: 'MIGRATE_ARGS_TOO_MANY',
      exitCode: 2
    })
  }

  const [sourceBranch = '', targetBranch = ''] = parsed.positionals
  const interactive = parsed.values.interactive || parsed.positionals.length < 2

  const result = await runMigrateWorkflow({
    sourceBranch,
    targetBranch,
    interactive,
    range: parsed.values.range,
    dryRun: parsed.values['dry-run'],
    push: parsed.values.push,
    yes: parsed.values.yes,
    repoMode: parsed.values['repo-mode'],
    noVerify: parsed.values['no-verify'],
    silentLog: parsed.values.json
  })

  if (parsed.values.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return result
  }

  if (result.canceled) {
    return
  }

  if (result.dryRun) {
    printDryRunPlan(result)
    return result
  }

  logger.success(
    `migrate 完成: ${result.sourceBranch} -> ${result.targetBranch}, commits=${result.migratedCommits}, mode=${result.rangeMode || 'range'}`
  )
}
