import { IcodeError } from '../core/errors.js'
import { resolveGitContext } from '../core/git-context.js'
import { GitService } from '../core/git-service.js'
import { logger } from '../core/logger.js'
import { chooseOne, confirm, input } from '../core/prompts.js'
import { runRollbackWorkflow } from './rollback-workflow.js'

const UNDO_OPTIONS = [
  {
    value: 'revert:HEAD',
    label: '安全回滚（revert HEAD，推荐）'
  },
  {
    value: 'soft:HEAD~1',
    label: '撤销最近一次提交，保留暂存区（reset --soft HEAD~1）'
  },
  {
    value: 'mixed:HEAD~1',
    label: '撤销最近一次提交，保留工作区（reset --mixed HEAD~1）'
  },
  {
    value: 'hard:HEAD~1',
    label: '强制回滚最近一次提交并丢弃改动（reset --hard HEAD~1）'
  },
  {
    value: 'cancel',
    label: '取消'
  }
]

function parseSelection(selection) {
  if (!selection || selection === 'cancel') {
    return {
      canceled: true
    }
  }

  const [mode, ref] = selection.split(':')
  return {
    mode,
    ref
  }
}

function normalizeRecover(value) {
  const normalized = (value || '').trim().toLowerCase()
  if (!normalized) {
    return ''
  }

  const allowed = new Set(['continue', 'abort', 'keep'])
  if (!allowed.has(normalized)) {
    throw new IcodeError('recover 仅支持: continue | abort | keep', {
      code: 'UNDO_RECOVER_INVALID',
      exitCode: 2
    })
  }

  return normalized
}

async function resolvePendingOperation(options) {
  const context = await resolveGitContext({
    cwd: options.cwd,
    repoMode: options.repoMode
  })

  const git = new GitService(context)
  const pending = await git.getInProgressOperation()
  if (!pending) {
    return null
  }

  logger.warn(`检测到未完成的 ${pending} 操作。`)

  let action = normalizeRecover(options.recover)
  if (!action) {
    if (options.yes) {
      throw new IcodeError(
        `自动模式下检测到未完成的 ${pending} 操作，请显式传 --recover continue|abort|keep。`,
        {
          code: 'UNDO_PENDING_OPERATION',
          exitCode: 2
        }
      )
    }

    action = await chooseOne(
      `未完成的 ${pending} 操作如何处理？`,
      [
        { value: 'continue', label: `继续 ${pending}（仅在冲突已解决后使用）` },
        { value: 'abort', label: `中止 ${pending}` },
        { value: 'keep', label: '保持现场，暂不处理' }
      ],
      2
    )
  }

  if (action === 'keep') {
    logger.warn('保持现场，未执行继续/中止。')
    return {
      canceled: true,
      pendingOperation: pending
    }
  }

  if (action === 'continue') {
    try {
      if (pending === 'revert') {
        await git.revertContinue()
      } else {
        await git.cherryPickContinue()
      }

      return {
        resolvedOperation: pending,
        recoverAction: 'continue'
      }
    } catch (error) {
      throw new IcodeError(
        `${pending} --continue 失败，请先解决冲突后重试，或使用 --recover abort。`,
        {
          code: 'UNDO_CONTINUE_FAILED',
          cause: error,
          meta: error.meta
        }
      )
    }
  }

  if (pending === 'revert') {
    await git.revertAbort()
  } else {
    await git.abortCherryPick()
  }

  return {
    resolvedOperation: pending,
    recoverAction: 'abort'
  }
}

async function handleRevertConflict(options, mode, ref) {
  let action = normalizeRecover(options.recover)

  if (!action) {
    if (options.yes) {
      throw new IcodeError('检测到 revert 冲突，请显式传 --recover abort 或先手工处理冲突。', {
        code: 'UNDO_REVERT_CONFLICT',
        exitCode: 2
      })
    }

    action = await chooseOne(
      '检测到 revert 冲突，下一步？',
      [
        { value: 'abort', label: '中止本次 revert（推荐）' },
        { value: 'continue', label: '继续 revert（需先手工解决冲突）' },
        { value: 'keep', label: '保持现场，稍后手工处理' }
      ],
      0
    )
  }

  if (action === 'keep') {
    return {
      canceled: true,
      mode,
      ref,
      conflict: 'revert'
    }
  }

  const context = await resolveGitContext({
    cwd: options.cwd,
    repoMode: options.repoMode
  })
  const git = new GitService(context)

  if (action === 'continue') {
    await git.revertContinue()
  } else {
    await git.revertAbort()
  }

  return {
    mode,
    ref,
    resolvedOperation: 'revert',
    recoverAction: action
  }
}

export async function runUndoWorkflow(options) {
  const pendingResult = await resolvePendingOperation(options)
  if (pendingResult) {
    return pendingResult
  }

  let mode = options.mode?.trim()
  let ref = options.ref?.trim()

  if (!mode) {
    const selected = await chooseOne('请选择回滚策略：', UNDO_OPTIONS, 0)
    const parsed = parseSelection(selected)
    if (parsed.canceled) {
      logger.warn('已取消 undo。')
      return {
        canceled: true
      }
    }

    mode = parsed.mode
    ref = parsed.ref
  }

  // 给用户最后一次确认，减少误用 reset/hard 造成的数据丢失风险。
  if (!options.yes) {
    const finalRef = ref || (mode === 'revert' ? 'HEAD' : 'HEAD~1')
    const answer = await input('请输入要回滚的 ref', finalRef)
    ref = answer.trim() || finalRef

    const accepted = await confirm(`确认执行 ${mode} 回滚，ref=${ref} ?`, mode !== 'hard')
    if (!accepted) {
      logger.warn('已取消 undo。')
      return {
        canceled: true,
        mode,
        ref
      }
    }
  }

  try {
    return await runRollbackWorkflow({
      ref,
      mode,
      yes: options.yes,
      repoMode: options.repoMode,
      cwd: options.cwd
    })
  } catch (error) {
    if (error?.code !== 'REVERT_CONFLICT') {
      throw error
    }

    logger.warn(error.message)
    return handleRevertConflict(options, mode, ref)
  }
}
