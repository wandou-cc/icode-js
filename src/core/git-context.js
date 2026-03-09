import fs from 'node:fs'
import path from 'node:path'
import { readConfig } from './config-store.js'
import { IcodeError } from './errors.js'
import { runCommand } from './shell.js'

function cleanOutput(text) {
  return (text || '').trim()
}

async function commandOutput(cwd, args, allowFailure = false) {
  const result = await runCommand('git', args, { cwd, allowFailure })
  return result
}

async function detectDefaultBranch(topLevelPath, fallbackCandidates = ['main', 'master']) {
  const headRefResult = await commandOutput(topLevelPath, ['symbolic-ref', 'refs/remotes/origin/HEAD'], true)
  if (headRefResult.exitCode === 0) {
    const headRef = cleanOutput(headRefResult.stdout)
    const branchName = headRef.replace('refs/remotes/origin/', '')
    if (branchName) {
      return branchName
    }
  }

  for (const candidate of fallbackCandidates) {
    const localRef = await commandOutput(topLevelPath, ['show-ref', '--verify', '--quiet', `refs/heads/${candidate}`], true)
    if (localRef.exitCode === 0) {
      return candidate
    }

    const remoteRef = await commandOutput(topLevelPath, ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${candidate}`], true)
    if (remoteRef.exitCode === 0) {
      return candidate
    }
  }

  return 'main'
}

export async function resolveGitContext(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd())
  const config = readConfig()
  const configRepoMode = config.defaults?.repoMode || 'auto'
  const repoMode = options.repoMode || configRepoMode

  const inside = await commandOutput(cwd, ['rev-parse', '--is-inside-work-tree'], true)
  if (inside.exitCode !== 0 || cleanOutput(inside.stdout) !== 'true') {
    throw new IcodeError('当前目录不在 Git 仓库中。', {
      code: 'NOT_IN_GIT_REPO',
      exitCode: 2
    })
  }

  const topLevelPath = cleanOutput((await commandOutput(cwd, ['rev-parse', '--show-toplevel'])).stdout)
  const gitDirRaw = cleanOutput((await commandOutput(cwd, ['rev-parse', '--git-dir'])).stdout)
  const commonDirRaw = cleanOutput((await commandOutput(cwd, ['rev-parse', '--git-common-dir'])).stdout)
  const currentBranch = cleanOutput((await commandOutput(topLevelPath, ['branch', '--show-current'], true)).stdout)
  const superproject = cleanOutput((await commandOutput(cwd, ['rev-parse', '--show-superproject-working-tree'], true)).stdout)

  const inheritedFromParent = path.resolve(cwd) !== path.resolve(topLevelPath)
  // strict 模式用于“防误操作”场景：如果当前目录只是父仓库的子目录，直接阻断。
  if (repoMode === 'strict' && inheritedFromParent) {
    throw new IcodeError(
      `检测到父级仓库继承: 当前目录 ${cwd} 实际仓库根目录为 ${topLevelPath}。strict 模式已阻止继续执行。`,
      {
        code: 'PARENT_REPO_INHERITED',
        exitCode: 2
      }
    )
  }

  const gitDir = path.isAbsolute(gitDirRaw) ? gitDirRaw : path.resolve(topLevelPath, gitDirRaw)
  const commonDir = path.isAbsolute(commonDirRaw) ? commonDirRaw : path.resolve(topLevelPath, commonDirRaw)

  const configuredHookPath = cleanOutput((await commandOutput(topLevelPath, ['config', '--get', 'core.hooksPath'], true)).stdout)
  // hooksPath 可能是相对路径，也可能是绝对路径，统一转成绝对路径便于后续检测。
  const hookPath = configuredHookPath
    ? (path.isAbsolute(configuredHookPath) ? configuredHookPath : path.resolve(topLevelPath, configuredHookPath))
    : path.resolve(gitDir, 'hooks')

  const hasHuskyFolder = fs.existsSync(path.resolve(topLevelPath, '.husky'))
  const hasHookPath = fs.existsSync(hookPath)

  const defaultBranch = await detectDefaultBranch(
    topLevelPath,
    config.defaults?.defaultMainBranches || ['main', 'master']
  )

  return {
    cwd,
    repoMode,
    topLevelPath,
    gitDir,
    commonDir,
    currentBranch,
    defaultBranch,
    inheritedFromParent,
    hasHuskyFolder,
    hookPath,
    hasHookPath,
    isSubmodule: Boolean(superproject),
    superprojectPath: superproject || null
  }
}
