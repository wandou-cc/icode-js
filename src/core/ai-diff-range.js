import { IcodeError } from './errors.js'
import { logger } from './logger.js'

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function readCommandErrorOutput(error) {
  return `${error?.meta?.stderr || ''}\n${error?.meta?.stdout || ''}\n${error?.message || ''}`.trim()
}

function summarizeGitError(error) {
  const text = readCommandErrorOutput(error)
  if (!text) {
    return ''
  }

  const lines = text
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)

  return lines[0] || ''
}

export async function resolveAiDiffRange({ git, context, baseRef = '', headRef = 'HEAD', label = 'AI', explicitHead = false }) {
  const explicitBase = Boolean((baseRef || '').trim())
  const remoteDefaultBase = `origin/${context.defaultBranch}`
  const localDefaultBase = context.defaultBranch || ''
  const candidates = explicitBase
    ? [(baseRef || '').trim()]
    : unique([remoteDefaultBase, localDefaultBase])

  if (explicitHead) {
    const headResult = await git.exec(['rev-parse', '--verify', `${headRef}^{commit}`], {
      allowFailure: true
    })

    if (headResult.exitCode !== 0) {
      const reason = summarizeGitError({
        meta: {
          stderr: headResult.stderr || '',
          stdout: headResult.stdout || ''
        }
      })

      throw new IcodeError(`指定终点不可用: ${headRef}${reason ? ` (${reason})` : ''}`, {
        code: 'AI_DIFF_HEAD_INVALID',
        exitCode: 2,
        meta: {
          headRef,
          reason,
          stderr: headResult.stderr || '',
          stdout: headResult.stdout || ''
        }
      })
    }
  }

  let lastError = null

  for (let index = 0; index < candidates.length; index += 1) {
    const candidateBase = candidates[index]
    try {
      const rangeResult = await git.diffBetween(candidateBase, headRef, { style: 'three-dot' })

      if (!explicitBase && index > 0) {
        logger.warn(`${label} 默认基线 ${remoteDefaultBase} 不可用，已回退到本地分支 ${candidateBase}。`)
      }

      return {
        ...rangeResult,
        baseRef: candidateBase,
        explicitBase
      }
    } catch (error) {
      lastError = error
      if (explicitBase) {
        break
      }
    }
  }

  const reason = summarizeGitError(lastError)

  if (explicitBase) {
    throw new IcodeError(`指定基线不可用: ${baseRef}${reason ? ` (${reason})` : ''}`, {
      code: 'AI_DIFF_BASE_INVALID',
      exitCode: 2,
      cause: lastError,
      meta: {
        baseRef,
        headRef,
        reason,
        stderr: lastError?.meta?.stderr || '',
        stdout: lastError?.meta?.stdout || ''
      }
    })
  }

  throw new IcodeError(
    `默认基线 ${remoteDefaultBase} 不可用，且无法回退到本地分支 ${localDefaultBase || '(empty)'}${reason ? ` (${reason})` : ''}`,
    {
      code: 'AI_DIFF_BASE_UNAVAILABLE',
      exitCode: 2,
      cause: lastError,
      meta: {
        baseRef: remoteDefaultBase,
        fallbackBase: localDefaultBase,
        headRef,
        reason,
        stderr: lastError?.meta?.stderr || '',
        stdout: lastError?.meta?.stdout || ''
      }
    }
  )
}
