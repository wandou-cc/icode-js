import { IcodeError } from '../core/errors.js'
import { resolveGitContext } from '../core/git-context.js'
import { GitService } from '../core/git-service.js'
import { logger } from '../core/logger.js'
import { confirm } from '../core/prompts.js'

function isRevertConflict(error) {
  const output = `${error?.meta?.stdout || ''}\n${error?.meta?.stderr || ''}\n${error?.message || ''}`
  return /revert is already in progress|could not revert|after resolving the conflicts|CONFLICT \(/i.test(output)
}

export async function runRollbackWorkflow(options) {
  const mode = options.mode || 'revert'
  const ref = options.ref || (mode === 'revert' ? 'HEAD' : 'HEAD~1')

  const context = await resolveGitContext({
    cwd: options.cwd,
    repoMode: options.repoMode
  })

  const git = new GitService(context)

  logger.info(`仓库根目录: ${context.topLevelPath}`)
  if (context.inheritedFromParent) {
    logger.warn('当前目录继承了父级 Git 仓库，命令将基于父仓库根目录执行。')
  }

  if (mode === 'revert') {
    logger.info(`执行回滚(revert): ${ref}`)
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
      logger.warn('已取消 hard 回滚。')
      return {
        canceled: true,
        mode,
        ref,
        repoRoot: context.topLevelPath
      }
    }
  }

  logger.info(`执行回滚(reset --${mode}): ${ref}`)
  await git.reset(mode, ref)

  return {
    mode,
    ref,
    repoRoot: context.topLevelPath
  }
}
