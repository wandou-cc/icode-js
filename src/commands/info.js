import { parseArgs } from 'node:util'
import { logger } from '../core/logger.js'
import { runInfoWorkflow } from '../workflows/info-workflow.js'

function printHelp() {
  process.stdout.write(`
Usage:
  icode info [options]

Options:
  --repo-mode <mode>     仓库模式: auto | strict
  -h, --help             查看帮助
`)
}

export async function runInfoCommand(rawArgs) {
  const parsed = parseArgs({
    args: rawArgs,
    allowPositionals: true,
    options: {
      'repo-mode': { type: 'string', default: 'auto' },
      help: { type: 'boolean', short: 'h', default: false }
    }
  })

  if (parsed.values.help) {
    printHelp()
    return
  }

  const result = await runInfoWorkflow({
    repoMode: parsed.values['repo-mode']
  })

  const infoBlock = {
    gitVersion: result.gitVersion,
    configPath: result.configPath,
    repoRoot: result.context.topLevelPath,
    cwd: result.context.cwd,
    inheritedFromParent: result.context.inheritedFromParent,
    currentBranch: result.context.currentBranch,
    defaultBranch: result.context.defaultBranch,
    hookPath: result.context.hookPath,
    hasHookPath: result.context.hasHookPath,
    hasHuskyFolder: result.context.hasHuskyFolder,
    isSubmodule: result.context.isSubmodule,
    superprojectPath: result.context.superprojectPath,
    protectedBranches: result.repoPolicy.protectedBranches || [],
    ai: result.aiConfig
  }

  process.stdout.write(`${JSON.stringify(infoBlock, null, 2)}\n`)
  logger.success('info 输出完成')
}
