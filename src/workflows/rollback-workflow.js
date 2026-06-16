import { IcodeError } from '../core/errors.js'
import { resolveGitContext } from '../core/git/context.js'
import { GitService } from '../core/git/service.js'
import { confirm } from '../core/tools/interactive.js'
import { logger } from '../core/tools/logger.js'

function isRevertConflict(error) {
  const output = `${error?.meta?.stdout || ''}\n${error?.meta?.stderr || ''}\n${error?.message || ''}`
  return /revert is already in progress|could not revert|after resolving the conflicts|CONFLICT \(/i.test(output)
}

// 静默模式下输出 info 日志，输入执行选项和日志文本，输出为空。
function logInfo(options, message) {
  if (!options.silentLog) {
    logger.info(message)
  }
}

// 静默模式下输出 warn 日志，输入执行选项和日志文本，输出为空。
function logWarn(options, message) {
  if (!options.silentLog) {
    logger.warn(message)
  }
}

// 执行底层回滚操作，输入 mode/ref/仓库选项，输出执行结果。
export async function runRollbackWorkflow(options) {
  const mode = options.mode || 'revert'
  const ref = options.ref || (mode === 'revert' ? 'HEAD' : 'HEAD~1')

  const context = await resolveGitContext({
    cwd: options.cwd,
    repoMode: options.repoMode
  })

  const git = new GitService(context)

  logInfo(options, `仓库根目录: ${context.topLevelPath}`)
  if (context.inheritedFromParent) {
    logWarn(options, '当前目录继承了父级 Git 仓库，命令将基于父仓库根目录执行。')
  }

  if (mode === 'revert') {
    logInfo(options, `执行回滚(revert): ${ref}`)
    try {
      await git.revert(ref)
    } catch (error) {
      if (isRevertConflict(error)) {
        throw new IcodeError(
          'revert 发生冲突。请解决冲突后执行 `git revert --continue`，或使用 `icode undo --recover abort` 直接中止。',
          {
            code: 'REVERT_CONFLICT',
            cause: error,
            meta: error.meta
          }
        )
      }
      throw error
    }
    return {
      mode,
      ref,
      repoRoot: context.topLevelPath
    }
  }

  if (!['soft', 'mixed', 'hard'].includes(mode)) {
    throw new IcodeError('mode 仅支持: revert | soft | mixed | hard', {
      code: 'ROLLBACK_MODE_INVALID',
      exitCode: 2
    })
  }

  if (mode === 'hard' && !options.yes) {
    // hard reset 会直接丢弃工作区改动，这里强制确认一次降低误操作风险。
    const accepted = await confirm(
      `你将执行 git reset --hard ${ref}，这会丢失未提交改动，是否继续？`,
      false
    )
    if (!accepted) {
      logWarn(options, '已取消 hard 回滚。')
      return {
        canceled: true,
        mode,
        ref,
        repoRoot: context.topLevelPath
      }
    }
  }

  logInfo(options, `执行回滚(reset --${mode}): ${ref}`)
  await git.reset(mode, ref)

  return {
    mode,
    ref,
    repoRoot: context.topLevelPath
  }
}
