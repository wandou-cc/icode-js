import { parseArgs } from 'node:util'
import { IcodeError } from '../core/errors.js'
import { getCompletionCandidates, renderCompletionScript } from '../core/completion.js'

/**
 * 输出 completion 命令帮助，说明支持的 shell 与安装方式。
 * 输入为空，输出为标准输出文本。
 */
function printHelp() {
  process.stdout.write(`
Usage:
  icode completion <bash|zsh>

Options:
  -h, --help             查看帮助

Examples:
  source <(icode completion bash)
  source <(icode completion zsh)
`)
}

/**
 * 解析隐藏补全命令参数，提取当前词与已确认参数列表。
 * 输入为隐藏命令的原始参数数组，输出为 current 和 previousWords。
 */
function parseHiddenCompletionArgs(rawArgs) {
  let current = ''
  let separatorIndex = rawArgs.indexOf('--')

  if (separatorIndex === -1) {
    separatorIndex = rawArgs.length
  }

  for (let index = 0; index < separatorIndex; index += 1) {
    const token = rawArgs[index]
    if (token === '--current') {
      current = rawArgs[index + 1] || ''
      index += 1
    }
  }

  return {
    current,
    previousWords: rawArgs.slice(separatorIndex + 1)
  }
}

/**
 * 执行公开的 completion 命令，输出对应 shell 的补全脚本。
 * 输入为命令行参数数组，输出为脚本文本到标准输出。
 */
export async function runCompletionCommand(rawArgs) {
  const parsed = parseArgs({
    args: rawArgs,
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h', default: false }
    }
  })

  if (parsed.values.help || parsed.positionals.length === 0) {
    printHelp()
    return
  }

  const [shellName] = parsed.positionals
  const normalizedShell = shellName.trim().toLowerCase()
  if (!['bash', 'zsh'].includes(normalizedShell)) {
    throw new IcodeError(`completion 仅支持 bash|zsh，当前输入: ${shellName}`, {
      code: 'COMPLETION_SHELL_INVALID',
      exitCode: 2
    })
  }

  process.stdout.write(renderCompletionScript(normalizedShell))
}

/**
 * 执行隐藏补全命令，只输出候选项，避免污染 shell 的补全结果。
 * 输入为隐藏命令参数数组，输出为逐行候选项到标准输出。
 */
export async function runHiddenCompletionCommand(rawArgs) {
  const { current, previousWords } = parseHiddenCompletionArgs(rawArgs)
  const candidates = getCompletionCandidates(previousWords, current)

  if (candidates.length > 0) {
    process.stdout.write(`${candidates.join('\n')}\n`)
  }
}
