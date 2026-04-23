import { IcodeError } from './errors.js'
import { buildHookHint, detectHookFailure } from './hook-diagnostics.js'
import { logger } from './logger.js'
import { runCommand } from './shell.js'
import fs from 'node:fs'
import path from 'node:path'

function cleanOutput(text) {
  return (text || '').trim()
}

function parseGitLogRecords(output) {
  return output
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash = '', subject = '', body = ''] = record.split('\x1f')
      return {
        hash: hash.trim(),
        subject: subject.trim(),
        body: body.trim()
      }
    })
    .filter((item) => item.hash && item.subject)
}

export class GitService {
  constructor(context) {
    this.context = context
    this.cwd = context.topLevelPath
  }

  async exec(args, options = {}) {
    logger.debug(`git ${args.join(' ')}`)
    return runCommand('git', args, { cwd: this.cwd, ...options })
  }

  async getCurrentBranch() {
    const result = await this.exec(['branch', '--show-current'], { allowFailure: true })
    return cleanOutput(result.stdout)
  }

  async revParseShort(ref = 'HEAD') {
    const result = await this.exec(['rev-parse', '--short', ref], { allowFailure: true })
    return cleanOutput(result.stdout)
  }

  async fetch() {
    await this.exec(['fetch', '--all', '--prune'])
  }

  operationFileExists(fileName) {
    const candidatePaths = [
      path.resolve(this.context.gitDir, fileName),
      path.resolve(this.context.commonDir, fileName)
    ]

    return candidatePaths.some((candidatePath) => fs.existsSync(candidatePath))
  }

  async getInProgressOperation() {
    if (this.operationFileExists('REVERT_HEAD')) {
      return 'revert'
    }

    if (this.operationFileExists('CHERRY_PICK_HEAD')) {
      return 'cherry-pick'
    }

    if (
      this.operationFileExists('REBASE_HEAD') ||
      this.operationFileExists('rebase-apply') ||
      this.operationFileExists('rebase-merge')
    ) {
      return 'rebase'
    }

    return null
  }

  async branchExistsLocal(branchName) {
    const result = await this.exec(['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], {
      allowFailure: true
    })
    return result.exitCode === 0
  }

  async branchExistsRemote(branchName) {
    const result = await this.exec(['ls-remote', '--exit-code', '--heads', 'origin', branchName], {
      allowFailure: true
    })
    return result.exitCode === 0
  }

  async getRemoteUrl(remoteName = 'origin') {
    const result = await this.exec(['remote', 'get-url', remoteName], {
      allowFailure: true
    })
    return cleanOutput(result.stdout)
  }

  async listLocalBranches() {
    const result = await this.exec(['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
    return result.stdout
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)
  }

  async listRemoteBranches(remoteName = 'origin') {
    const result = await this.exec(['for-each-ref', '--format=%(refname:strip=3)', `refs/remotes/${remoteName}`], {
      allowFailure: true
    })

    if (result.exitCode !== 0) {
      return []
    }

    return result.stdout
      .split('\n')
      .map((item) => item.trim())
      .filter((item) => item && item !== 'HEAD')
  }

  async listMergedLocalBranches(targetRef) {
    const result = await this.exec(['branch', '--merged', targetRef])
    return result.stdout
      .split('\n')
      .map((item) => item.replace('*', '').trim())
      .filter(Boolean)
  }

  async checkout(branchName) {
    await this.exec(['checkout', branchName])
  }

  async checkoutTracking(branchName) {
    await this.exec(['checkout', '-b', branchName, '--track', `origin/${branchName}`])
  }

  async checkoutNewBranch(branchName, fromBranch) {
    await this.exec(['checkout', '-b', branchName, fromBranch])
  }

  async createTrackingFromRemote(branchName) {
    await this.exec(['branch', '--track', branchName, `origin/${branchName}`])
  }

  async pull(branchName, options = {}) {
    const args = ['pull', 'origin', branchName]

    if (options.noRebase !== false) {
      args.push('--no-rebase')
    }

    if (options.ffOnly) {
      args.push('--ff-only')
    }

    if (options.allowUnrelatedHistories) {
      args.push('--allow-unrelated-histories')
    }

    await this.exec(args)
  }

  async merge(fromBranch, options = {}) {
    const args = ['merge', fromBranch]
    if (options.noFf !== false) {
      args.push('--no-ff')
    }
    if (options.noEdit !== false) {
      args.push('--no-edit')
    }
    await this.exec(args)
  }

  async rebase(fromRef) {
    await this.exec(['rebase', fromRef])
  }

  async rebaseAbort() {
    await this.exec(['rebase', '--abort'], { allowFailure: true })
  }

  async statusPorcelain() {
    // 返回标准 porcelain 状态，供上层统一判断“是否存在未提交改动”。
    const result = await this.exec(['status', '--porcelain'])
    return result.stdout
  }

  async hasChanges() {
    // 只要 porcelain 有输出，就说明暂存区、工作区或未跟踪文件存在改动。
    const output = await this.statusPorcelain()
    return cleanOutput(output).length > 0
  }

  // 列出未被忽略的未跟踪文件，供 AI 工作流补全新文件 diff。
  async listUntrackedFiles() {
    const result = await this.exec(['ls-files', '--others', '--exclude-standard'])
    return result.stdout
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)
  }

  // 通过 no-index diff 生成“/dev/null -> 新文件”的补丁，覆盖未跟踪文件内容。
  async buildUntrackedFileDiff(filePath) {
    const result = await this.exec(['diff', '--no-index', '--binary', '--', '/dev/null', filePath], {
      allowFailure: true
    })
    return result.stdout
  }

  async diffWorkingTree() {
    // git diff 默认不包含 untracked 文件，这里显式补齐，避免新仓库被误判成“无改动”。
    const trackedResult = await this.exec(['diff'])
    const untrackedFiles = await this.listUntrackedFiles()
    const untrackedDiffs = []

    for (const filePath of untrackedFiles) {
      const diff = await this.buildUntrackedFileDiff(filePath)
      if (cleanOutput(diff)) {
        untrackedDiffs.push(diff.trimEnd())
      }
    }

    return [trackedResult.stdout.trimEnd(), ...untrackedDiffs]
      .filter(Boolean)
      .join('\n\n')
  }

  async diffStaged() {
    const result = await this.exec(['diff', '--staged'])
    return result.stdout
  }

  async diffStagedStat() {
    const result = await this.exec(['diff', '--staged', '--stat'])
    return result.stdout
  }

  async diffStagedNameStatus() {
    const result = await this.exec(['diff', '--staged', '--name-status'])
    return result.stdout
  }

  async diffStat(rangeSpec = '') {
    const args = ['diff', '--stat']
    if (rangeSpec) {
      args.push(rangeSpec)
    }
    const result = await this.exec(args)
    return result.stdout
  }

  async diffNameStatus(rangeSpec = '') {
    const args = ['diff', '--name-status']
    if (rangeSpec) {
      args.push(rangeSpec)
    }
    const result = await this.exec(args)
    return result.stdout
  }

  async diffBetween(baseRef, headRef, options = {}) {
    const style = options.style === 'two-dot' ? '..' : '...'
    const rangeSpec = `${baseRef}${style}${headRef}`
    const args = ['diff', rangeSpec]
    const result = await this.exec(args)
    return {
      rangeSpec,
      diff: result.stdout
    }
  }

  async logOneline(rangeSpec = '', limit = 30) {
    const args = ['log', '--oneline', `-${limit}`]
    if (rangeSpec) {
      args.push(rangeSpec)
    }
    const result = await this.exec(args, { allowFailure: true })
    return result.stdout
  }

  async showCommitSummary(ref) {
    const result = await this.exec(['show', '-s', '--format=%h %s', ref], { allowFailure: true })
    return cleanOutput(result.stdout)
  }

  async listConflictedFiles() {
    const result = await this.exec(['diff', '--name-only', '--diff-filter=U'])
    return result.stdout
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)
  }

  async showFile(filePath) {
    const result = await this.exec(['show', `:${filePath}`], { allowFailure: true })
    return result.stdout || ''
  }

  async stageAll() {
    await this.exec(['add', '-A'])
  }

  async commit(message, options = {}) {
    if (!message || !message.trim()) {
      throw new IcodeError('提交信息不能为空，请使用 -m 或 --message 指定。', {
        code: 'COMMIT_MESSAGE_REQUIRED',
        exitCode: 2
      })
    }

    const args = ['commit', '-m', message]
    if (options.noVerify) {
      args.push('--no-verify')
    }

    try {
      await this.exec(args)
    } catch (error) {
      // 统一识别 husky / hooks 拦截，给出明确可执行的提示。
      if (detectHookFailure(error)) {
        throw new IcodeError(buildHookHint('git commit'), {
          code: 'HOOK_COMMIT_BLOCKED',
          cause: error,
          meta: error.meta
        })
      }
      throw error
    }
  }

  async push(branchName, options = {}) {
    const args = ['push']

    if (options.noVerify) {
      args.push('--no-verify')
    }

    args.push('origin', branchName)

    if (options.setUpstream) {
      args.push('--set-upstream')
    }

    try {
      await this.exec(args)
    } catch (error) {
      // push 同样可能被 pre-push 等 hook 拦截，这里统一转成可读错误。
      if (detectHookFailure(error)) {
        throw new IcodeError(buildHookHint('git push'), {
          code: 'HOOK_PUSH_BLOCKED',
          cause: error,
          meta: error.meta
        })
      }
      throw error
    }
  }

  async pushRefspec(sourceBranch, targetBranch, options = {}) {
    const args = ['push']

    if (options.noVerify) {
      args.push('--no-verify')
    }

    args.push('origin', `${sourceBranch}:${targetBranch}`)

    try {
      await this.exec(args)
    } catch (error) {
      if (detectHookFailure(error)) {
        throw new IcodeError(buildHookHint('git push(refspec)'), {
          code: 'HOOK_PUSH_REFSPEC_BLOCKED',
          cause: error,
          meta: error.meta
        })
      }
      throw error
    }
  }

  async listTags(pattern = '*') {
    const result = await this.exec(['tag', '--list', pattern])
    return result.stdout
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)
  }

  async createAnnotatedTag(tagName, message, fromRef) {
    const args = ['tag', '-a', tagName, '-m', message]
    if (fromRef) {
      args.push(fromRef)
    }
    await this.exec(args)
  }

  async pushTag(tagName, options = {}) {
    const args = ['push']
    if (options.noVerify) {
      args.push('--no-verify')
    }
    args.push('origin', tagName)

    try {
      await this.exec(args)
    } catch (error) {
      if (detectHookFailure(error)) {
        throw new IcodeError(buildHookHint('git push(tag)'), {
          code: 'HOOK_TAG_PUSH_BLOCKED',
          cause: error,
          meta: error.meta
        })
      }
      throw error
    }
  }

  async reset(mode, ref = 'HEAD~1') {
    const validModes = new Set(['soft', 'mixed', 'hard'])
    if (!validModes.has(mode)) {
      throw new IcodeError(`不支持的 reset 模式: ${mode}`, {
        code: 'RESET_MODE_INVALID',
        exitCode: 2
      })
    }

    await this.exec(['reset', `--${mode}`, ref])
  }

  async revert(ref = 'HEAD') {
    await this.exec(['revert', '--no-edit', ref])
  }

  async revertContinue() {
    await this.exec(['revert', '--continue'])
  }

  async revertAbort() {
    await this.exec(['revert', '--abort'], { allowFailure: true })
  }

  async revList(rangeSpec) {
    const result = await this.exec(['rev-list', '--reverse', rangeSpec])
    return result.stdout
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)
  }

  // 读取指定 range 内的提交信息，返回按时间顺序排列的 hash/subject/body 列表。
  async listCommitMessages(rangeSpec) {
    const result = await this.exec(['log', '--reverse', '--format=%H%x1f%s%x1f%b%x1e', rangeSpec], {
      allowFailure: true
    })
    return parseGitLogRecords(result.stdout)
  }

  // 读取单个 ref 的最新提交信息，供无法从 range 提取提交时回退使用。
  async getCommitMessage(ref = 'HEAD') {
    const result = await this.exec(['log', '-1', '--format=%H%x1f%s%x1f%b%x1e', ref], {
      allowFailure: true
    })
    const commits = parseGitLogRecords(result.stdout)
    return commits[0] || null
  }

  async cherryPick(commits) {
    const normalized = Array.isArray(commits) ? commits : [commits]
    const list = normalized.map((item) => item.trim()).filter(Boolean)
    if (!list.length) {
      return
    }

    await this.exec(['cherry-pick', ...list])
  }

  async cherryPickContinue() {
    await this.exec(['cherry-pick', '--continue'])
  }

  async abortCherryPick() {
    await this.exec(['cherry-pick', '--abort'], { allowFailure: true })
  }

  async deleteLocalBranch(branchName, options = {}) {
    const args = ['branch', options.force ? '-D' : '-d', branchName]
    await this.exec(args)
  }

  async deleteRemoteBranch(branchName) {
    await this.exec(['push', 'origin', '--delete', branchName])
  }
}
