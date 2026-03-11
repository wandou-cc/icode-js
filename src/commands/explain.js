import { parseArgs } from 'node:util'
import { getAiCommandOptions } from '../core/ai-config.js'
import { logger } from '../core/logger.js'
import { runAiExplainWorkflow } from '../workflows/ai-explain-workflow.js'

function printHelp() {
  process.stdout.write(`
Usage:
  icode explain [options]

Options:
  --base <ref>            diff 基线，默认 origin/<defaultBranch>；不可用时回退到本地默认分支
  --head <ref>            diff 终点，默认 HEAD
  --profile <name>        指定 AI profile
  --repo-mode <mode>      仓库模式: auto(自动继承父仓库) | strict(禁止继承)
  --dump-response         输出 AI 原始响应（调试数据格式）
  -h, --help              查看帮助
`)
}

function resolveBooleanOption(cliValue, configValue, fallback = false) {
  if (typeof cliValue === 'boolean') {
    return cliValue
  }
  if (typeof configValue === 'boolean') {
    return configValue
  }
  if (typeof configValue === 'string') {
    const normalized = configValue.trim().toLowerCase()
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
      return true
    }
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
      return false
    }
  }
  return fallback
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

export async function runExplainCommand(rawArgs) {
  const scopedOptions = getAiCommandOptions('explain')
  const parsed = parseArgs({
    args: rawArgs,
    allowPositionals: true,
    options: {
      base: { type: 'string' },
      head: { type: 'string' },
      profile: { type: 'string' },
      'repo-mode': { type: 'string' },
      'dump-response': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    }
  })

  if (parsed.values.help) {
    printHelp()
    return
  }

  const result = await runAiExplainWorkflow({
    baseRef: resolveStringOption(parsed.values.base, scopedOptions.base, ''),
    headRef: resolveStringOption(parsed.values.head, scopedOptions.head, ''),
    profile: resolveStringOption(parsed.values.profile, scopedOptions.profile, ''),
    repoMode: resolveStringOption(parsed.values['repo-mode'], scopedOptions.repoMode, 'auto'),
    dumpResponse: resolveBooleanOption(parsed.values['dump-response'], scopedOptions.dumpResponse, false)
  })

  logger.info(`Explain 范围: ${result.rangeSpec}`)
  process.stdout.write(`\n${result.explanation}\n`)
}
