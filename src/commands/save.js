import { parseArgs } from 'node:util'
import { normalizeLegacyArgs } from '../core/cli/args.js'
import { logger } from '../core/tools/logger.js'
import { runSaveWorkflow } from '../workflows/save-workflow.js'

/**
 * 输出 save 子命令帮助。
 * 输入为空，输出标准帮助文本。
 */
function printHelp() {
  process.stdout.write(`
Usage:
  icode save (--message <msg> | --ai-commit) [options]

Options:
  -m, --message <msg>    指定提交信息
  --ai-commit            使用 AI 根据全部未提交改动生成提交信息
  --profile <name>       指定 AI profile（仅 --ai-commit 使用）
  --lang <zh|en>         AI 提交信息语言，默认 zh
  --dry-run              只检查并展示将提交的信息，不执行 add/commit
  --json                 输出机器可读 JSON
  --repo-mode <mode>     仓库模式: auto(自动继承父仓库) | strict(禁止继承)
  --no-verify            commit 时跳过 hook/husky 校验
  -y, --yes              自动确认 AI 提交（仅 --ai-commit 且非 dry-run 时有意义）
  -h, --help             查看帮助

Notes:
  save 是安全快速提交场景：检查状态 -> 暂存全部改动 -> commit。不会 push。
`)
}

/**
 * 输出 save 人类可读结果。
 * 输入为 workflow 结果，输出分色摘要。
 */
function printSaveResult(result) {
  logger.info(`仓库根目录: ${result.context.topLevelPath}`)
  logger.info(`当前分支: ${logger.color('green', result.context.currentBranch)}`)
  logger.info(`提交来源: ${result.source === 'ai' ? logger.color('cyan', 'AI') : logger.color('cyan', 'message')}`)
  logger.info(`改动统计: staged=${result.changes.staged}, unstaged=${result.changes.unstaged}, untracked=${result.changes.untracked}`)

  if (result.dryRun) {
    logger.warn('dry-run: 未执行 git add 或 git commit')
    logger.info(`计划提交信息:\n${logger.color('yellow', result.commitMessage)}`)
    return
  }

  logger.success(`本地提交已创建: ${logger.color('green', result.commitId)}`)
  logger.info(`提交信息:\n${result.commitMessage}`)
}

/**
 * 执行 save 子命令。
 * 输入为原始参数，输出 save workflow 结果；关键假设是提交信息来源必须显式且唯一。
 */
export async function runSaveCommand(rawArgs) {
  const args = normalizeLegacyArgs(rawArgs)
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      message: { type: 'string', short: 'm' },
      'ai-commit': { type: 'boolean', default: false },
      profile: { type: 'string', default: '' },
      lang: { type: 'string', default: 'zh' },
      'dry-run': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      'repo-mode': { type: 'string', default: 'auto' },
      'no-verify': { type: 'boolean', default: false },
      yes: { type: 'boolean', short: 'y', default: false },
      help: { type: 'boolean', short: 'h', default: false }
    }
  })

  if (parsed.values.help) {
    printHelp()
    return
  }

  const result = await runSaveWorkflow({
    message: parsed.values.message,
    aiCommit: parsed.values['ai-commit'],
    profile: parsed.values.profile,
    lang: parsed.values.lang,
    dryRun: parsed.values['dry-run'],
    repoMode: parsed.values['repo-mode'],
    noVerify: parsed.values['no-verify'],
    yes: parsed.values.yes
  })

  if (parsed.values.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return result
  }

  printSaveResult(result)
  return result
}
