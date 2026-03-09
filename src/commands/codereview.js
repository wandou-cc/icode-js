import { parseArgs } from 'node:util'
import { getAiCommandOptions } from '../core/ai-config.js'
import { logger } from '../core/logger.js'
import { runAiCodeReviewWorkflow } from '../workflows/ai-codereview-workflow.js'

function printHelp() {
  process.stdout.write(`
Usage:
  icode codereview [options]

Options:
  --base <ref>            diff 基线，默认 origin/<defaultBranch>
  --head <ref>            diff 终点，默认 HEAD
  --focus <text>          评审重点（安全/性能/测试等）
  --profile <name>        指定 AI profile
  --repo-mode <mode>      仓库模式: auto | strict
  -h, --help              查看帮助
`)
}

function resolveStringOption(cliValue, configValue, fallback = '') {
  if (typeof cliValue === 'string' && cliValue.trim()) {
    return cliValue
  }
  if (typeof configValue === 'string' && configValue.trim()) {
    return configValue
  }
  return fallback
}

export async function runCodeReviewCommand(rawArgs) {
  const scopedOptions = getAiCommandOptions('codereview')
  const parsed = parseArgs({
    args: rawArgs,
    allowPositionals: true,
    options: {
      base: { type: 'string' },
      head: { type: 'string' },
      focus: { type: 'string' },
      profile: { type: 'string' },
      'repo-mode': { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    }
  })

  if (parsed.values.help) {
    printHelp()
    return
  }

  const result = await runAiCodeReviewWorkflow({
    baseRef: resolveStringOption(parsed.values.base, scopedOptions.base, ''),
    headRef: resolveStringOption(parsed.values.head, scopedOptions.head, ''),
    focus: resolveStringOption(parsed.values.focus, scopedOptions.focus, ''),
    profile: resolveStringOption(parsed.values.profile, scopedOptions.profile, ''),
    repoMode: resolveStringOption(parsed.values['repo-mode'], scopedOptions.repoMode, 'auto')
  })

  logger.info(`Code Review 范围: ${result.rangeSpec}`)
  process.stdout.write(`\n${result.review}\n`)
}
