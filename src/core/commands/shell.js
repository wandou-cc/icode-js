import { spawn } from 'node:child_process'
import { IcodeError } from '../errors.js'

/**
 * 把命令与参数拼成可读字符串，供日志与报错复用。
 * 输入为命令名与参数数组，输出为单行命令文本。
 */
function stringifyCommand(command, args) {
  return [command, ...args].join(' ')
}

/**
 * 组合命令失败消息，尽量附带 stderr/stdout 便于定位问题。
 * 输入为命令信息与执行结果，输出为最终错误文案。
 */
function formatFailureMessage(command, args, result) {
  const baseMessage = `命令执行失败(${result.exitCode}): ${stringifyCommand(command, args)}`
  const detailLines = [result.stderr, result.stdout].map((item) => item.trim()).filter(Boolean)

  if (!detailLines.length) {
    return baseMessage
  }

  return `${baseMessage}\n${detailLines.join('\n')}`
}

/**
 * 执行外部命令并收集 stdout/stderr；允许按需把非零退出码作为普通结果返回。
 * 输入为命令名、参数数组与执行选项，输出为标准化执行结果。
 */
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
