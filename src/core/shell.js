import { spawn } from 'node:child_process'
import { IcodeError } from './errors.js'

function stringifyCommand(command, args) {
  return [command, ...args].join(' ')
}

function formatFailureMessage(command, args, result) {
  const baseMessage = `命令执行失败(${result.exitCode}): ${stringifyCommand(command, args)}`
  const detailLines = [result.stderr, result.stdout].map((item) => item.trim()).filter(Boolean)

  if (!detailLines.length) {
    return baseMessage
  }

  return `${baseMessage}\n${detailLines.join('\n')}`
}

export async function runCommand(command, args = [], options = {}) {
  const { cwd = process.cwd(), env = process.env, allowFailure = false } = options

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      reject(
        new IcodeError(`执行命令失败: ${stringifyCommand(command, args)}`, {
          cause: error,
          code: 'COMMAND_SPAWN_ERROR',
          meta: {
            command,
            args,
            cwd
          }
        })
      )
    })

    child.on('close', (exitCode) => {
      const result = {
        command,
        args,
        cwd,
        exitCode,
        stdout,
        stderr
      }

      if (exitCode === 0 || allowFailure) {
        resolve(result)
        return
      }

      reject(
        new IcodeError(formatFailureMessage(command, args, result), {
          code: 'COMMAND_EXEC_ERROR',
          meta: result
        })
      )
    })
  })
}
