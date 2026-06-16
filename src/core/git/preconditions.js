import { IcodeError } from '../errors.js'

/**
 * 读取当前仓库执行状态。
 * 输入为 GitService 实例，输出当前分支、未完成操作和工作区改动摘要。
 */
export async function readGitSafetyState(git) {
  const [currentBranch, operation, changes] = await Promise.all([
    git.getCurrentBranch(),
    git.getInProgressOperation(),
    git.getStatusSummary()
  ])

  return {
    currentBranch,
    operation,
    changes
  }
}

/**
 * 断言当前处于普通分支。
 * 输入为分支名、命令名和错误码，输出为空；不满足时抛出 IcodeError。
 */
export function assertOnBranch(currentBranch, commandName, code) {
  if (currentBranch) {
    return
  }

  throw new IcodeError(`当前不在普通分支上，${commandName} 已停止。`, {
    code,
    exitCode: 2
  })
}

/**
 * 断言不存在未完成的 Git 操作。
 * 输入为操作名、命令名和错误码，输出为空；检测到 merge/rebase/cherry-pick/revert 时抛错。
 */
export function assertNoPendingOperation(operation, commandName, code) {
  if (!operation) {
    return
  }

  throw new IcodeError(`检测到未完成的 Git 操作: ${operation}。请先完成或中止该操作，${commandName} 已停止。`, {
    code,
    exitCode: 2,
    meta: {
      operation
    }
  })
}

/**
 * 断言不存在冲突文件。
 * 输入为改动摘要、命令名和错误码，输出为空；存在冲突文件时抛错。
 */
export function assertNoConflictedFiles(changes, commandName, code) {
  if (!changes || changes.conflicted === 0) {
    return
  }

  throw new IcodeError(`存在 ${changes.conflicted} 个冲突文件，${commandName} 已停止。`, {
    code,
    exitCode: 2,
    meta: {
      changes
    }
  })
}

/**
 * 断言工作区干净。
 * 输入为改动摘要、命令名和错误码，输出为空；存在任何未提交改动时抛错。
 */
export function assertCleanWorktree(changes, commandName, code) {
  if (changes && changes.clean) {
    return
  }

  throw new IcodeError(`工作区存在未提交改动，${commandName} 已停止。请先执行 save 或手动清理。`, {
    code,
    exitCode: 2,
    meta: {
      changes
    }
  })
}
