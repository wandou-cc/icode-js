import { getAiConfig } from '../core/ai-config.js'
import { getConfigFilePath, getRepoPolicy } from '../core/config-store.js'
import { resolveGitContext } from '../core/git-context.js'
import { runCommand } from '../core/shell.js'

export async function runInfoWorkflow(options) {
  const context = await resolveGitContext({
    cwd: options.cwd,
    repoMode: options.repoMode
  })

  const gitVersion = await runCommand('git', ['--version'], {
    cwd: context.topLevelPath,
    allowFailure: true
  })

  const repoPolicy = getRepoPolicy(context.topLevelPath)
  const aiConfig = getAiConfig()

  return {
    configPath: getConfigFilePath(),
    gitVersion: (gitVersion.stdout || '').trim(),
    context,
    repoPolicy,
    aiConfig: {
      activeProfile: aiConfig.activeProfile,
      profileCount: Object.keys(aiConfig.profiles || {}).length
    }
  }
}
