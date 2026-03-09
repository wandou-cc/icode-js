import path from 'node:path'
import { parseArgs } from 'node:util'
import { askAi } from '../core/ai-client.js'
import {
  getAiCommandOptions,
  getAiProfileForDisplay,
  listAiCommandOptions,
  listAiProfiles,
  removeAiCommandOptions,
  removeAiProfile,
  upsertAiCommandOptions,
  upsertAiProfile,
  useAiProfile
} from '../core/ai-config.js'
import {
  deleteValue,
  getConfigFilePath,
  getRepoPolicy,
  getValue,
  readConfig,
  setRepoPolicy,
  setValue
} from '../core/config-store.js'
import { parseConfigValue } from '../core/args.js'
import { IcodeError } from '../core/errors.js'
import { resolveGitContext } from '../core/git-context.js'
import { logger } from '../core/logger.js'

function printHelp() {
  process.stdout.write(`
Usage:
  icode config <command> [...args]

Commands:
  list
  get <path>
  set <path> <value>
  delete <path>
  ai <subcommand> [...]
  protect list
  protect add <branch...>
  protect remove <branch...>

Examples:
  icode config set defaults.repoMode strict
  icode config get defaults.repoMode
  icode config protect add main release
  icode config ai set openai --format openai --base-url https://api.openai.com/v1 --api-key sk-xxx --model gpt-4o-mini --activate
  icode config ai set ollama --format ollama --base-url http://127.0.0.1:11434 --model qwen2.5:7b --activate
`)
}

function printAiHelp() {
  process.stdout.write(`
Usage:
  icode config ai <subcommand> [options]

Subcommands:
  list
  show [profile]
  set <profile> --format <openai|anthropic|ollama> --base-url <url> --api-key <key> --model <name> [--headers <json>] [--activate]
  options <list|show|set|remove> [...]
  use <profile>
  remove <profile>
  test [profile]

Examples:
  icode config ai list
  icode config ai show
  icode config ai set claude --format anthropic --base-url https://api.anthropic.com/v1 --api-key xxx --model claude-3-5-sonnet-20241022 --activate
  icode config ai options set commit --json '{"profile":"local","lang":"zh","yes":true}'
  icode config ai options set push --json '{"aiCommit":true,"aiReview":true,"aiProfile":"local","yes":true}'
  icode config ai set ollama --format ollama --base-url http://127.0.0.1:11434 --model qwen2.5:7b --activate
  icode config ai use claude
  icode config ai test claude
`)
}

function parseJsonObject(rawValue) {
  if (!rawValue) {
    return {}
  }

  try {
    const parsed = JSON.parse(rawValue)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('headers 必须是 JSON 对象')
    }
    return parsed
  } catch (error) {
    throw new IcodeError(`headers 解析失败: ${error.message}`, {
      code: 'CONFIG_AI_HEADERS_INVALID',
      exitCode: 2
    })
  }
}

function compactObject(value) {
  const next = {}
  Object.entries(value).forEach(([key, item]) => {
    if (item !== undefined) {
      next[key] = item
    }
  })
  return next
}

function parseOptionsJson(rawValue) {
  if (!rawValue) {
    throw new IcodeError('缺少 --json 参数，示例: --json \'{"profile":"local"}\'', {
      code: 'CONFIG_AI_OPTIONS_JSON_REQUIRED',
      exitCode: 2
    })
  }

  return parseJsonObject(rawValue)
}

function printAiOptionsHelp() {
  process.stdout.write(`
Usage:
  icode config ai options <command> [options]

Commands:
  list
  show <scope>
  set <scope> --json <json> [--replace]
  remove <scope>

Available scope:
  commit | conflict | codereview | push

Examples:
  icode config ai options list
  icode config ai options show commit
  icode config ai options set commit --json '{"profile":"local","lang":"zh","yes":true}'
  icode config ai options set codereview --json '{"profile":"local","base":"origin/main"}'
  icode config ai options set push --json '{"aiCommit":true,"aiReview":true,"aiProfile":"local","yes":true}'
  icode config ai options remove push
`)
}

async function runAiOptionsCommand(args) {
  if (!args.length || args[0] === '-h' || args[0] === '--help') {
    printAiOptionsHelp()
    return
  }

  const [action, ...rest] = args

  if (action === 'list') {
    process.stdout.write(`${JSON.stringify(listAiCommandOptions(), null, 2)}\n`)
    return
  }

  if (action === 'show') {
    const [scopeName] = rest
    const scopedOptions = getAiCommandOptions(scopeName)
    process.stdout.write(`${JSON.stringify(scopedOptions, null, 2)}\n`)
    return
  }

  if (action === 'set') {
    const parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        json: { type: 'string' },
        replace: { type: 'boolean', default: false }
      }
    })

    const [scopeName] = parsed.positionals
    if (!scopeName) {
      throw new IcodeError('缺少 options 作用域: icode config ai options set <scope> --json ...', {
        code: 'CONFIG_AI_OPTIONS_SCOPE_REQUIRED',
        exitCode: 2
      })
    }

    const next = upsertAiCommandOptions(scopeName, parseOptionsJson(parsed.values.json), {
      replace: parsed.values.replace
    })

    logger.success(`AI options 已写入: ${scopeName}`)
    process.stdout.write(`${JSON.stringify(next, null, 2)}\n`)
    return
  }

  if (action === 'remove') {
    const [scopeName] = rest
    if (!scopeName) {
      throw new IcodeError('缺少 options 作用域: icode config ai options remove <scope>', {
        code: 'CONFIG_AI_OPTIONS_SCOPE_REQUIRED',
        exitCode: 2
      })
    }

    removeAiCommandOptions(scopeName)
    logger.success(`AI options 已删除: ${scopeName}`)
    return
  }

  throw new IcodeError(`未知 ai options 子命令: ${action}`, {
    code: 'CONFIG_AI_OPTIONS_UNKNOWN_SUBCOMMAND',
    exitCode: 2
  })
}

async function runAiConfigCommand(args) {
  if (!args.length || args[0] === '-h' || args[0] === '--help') {
    printAiHelp()
    return
  }

  const [action, ...rest] = args

  if (action === 'options') {
    await runAiOptionsCommand(rest)
    return
  }

  if (action === 'list') {
    const profiles = listAiProfiles()
    if (!profiles.length) {
      logger.warn('当前没有 AI profile。')
      return
    }

    process.stdout.write(`${JSON.stringify(profiles, null, 2)}\n`)
    return
  }

  if (action === 'show') {
    const [profileName] = rest
    const profile = getAiProfileForDisplay(profileName)
    process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`)
    return
  }

  if (action === 'set') {
    const parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        provider: { type: 'string' },
        format: { type: 'string' },
        'base-url': { type: 'string' },
        'api-key': { type: 'string' },
        model: { type: 'string' },
        temperature: { type: 'string' },
        'max-tokens': { type: 'string' },
        headers: { type: 'string' },
        activate: { type: 'boolean', default: false }
      }
    })

    const [profileName] = parsed.positionals
    if (!profileName) {
      throw new IcodeError('缺少 profile 名称: icode config ai set <profile> ...', {
        code: 'CONFIG_AI_PROFILE_REQUIRED',
        exitCode: 2
      })
    }

    const profile = upsertAiProfile(profileName, compactObject({
      provider: parsed.values.provider,
      format: parsed.values.format,
      baseUrl: parsed.values['base-url'],
      apiKey: parsed.values['api-key'],
      model: parsed.values.model,
      temperature: parsed.values.temperature,
      maxTokens: parsed.values['max-tokens'],
      headers: parsed.values.headers ? parseJsonObject(parsed.values.headers) : undefined
    }))

    if (parsed.values.activate) {
      useAiProfile(profileName)
    }

    logger.success(`AI profile 已写入: ${profile.name}`)
    return
  }

  if (action === 'use') {
    const [profileName] = rest
    if (!profileName) {
      throw new IcodeError('缺少 profile 名称: icode config ai use <profile>', {
        code: 'CONFIG_AI_PROFILE_REQUIRED',
        exitCode: 2
      })
    }

    useAiProfile(profileName)
    logger.success(`已切换 AI profile: ${profileName}`)
    return
  }

  if (action === 'remove') {
    const [profileName] = rest
    if (!profileName) {
      throw new IcodeError('缺少 profile 名称: icode config ai remove <profile>', {
        code: 'CONFIG_AI_PROFILE_REQUIRED',
        exitCode: 2
      })
    }

    removeAiProfile(profileName)
    logger.success(`已删除 AI profile: ${profileName}`)
    return
  }

  if (action === 'test') {
    const [profileName] = rest
    const response = await askAi(
      {
        systemPrompt: 'You are an API connectivity checker.',
        userPrompt: 'Return exactly one word: pong'
      },
      {
        profile: profileName
      }
    )
    logger.success(`AI 连通性测试成功: ${response}`)
    return
  }

  throw new IcodeError(`未知 ai 子命令: ${action}`, {
    code: 'CONFIG_AI_UNKNOWN_SUBCOMMAND',
    exitCode: 2
  })
}

async function resolvePolicyRoot(repoMode) {
  try {
    const context = await resolveGitContext({ repoMode })
    return context.topLevelPath
  } catch {
    return path.resolve(process.cwd())
  }
}

export async function runConfigCommand(rawArgs) {
  if (rawArgs[0] === 'ai') {
    await runAiConfigCommand(rawArgs.slice(1))
    return
  }

  const parsed = parseArgs({
    args: rawArgs,
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h', default: false },
      'repo-mode': { type: 'string', default: 'auto' }
    }
  })

  if (parsed.values.help || parsed.positionals.length === 0) {
    printHelp()
    return
  }

  const [command, ...rest] = parsed.positionals

  if (command === 'list') {
    process.stdout.write(`${JSON.stringify(readConfig(), null, 2)}\n`)
    logger.info(`配置文件路径: ${getConfigFilePath()}`)
    return
  }

  if (command === 'get') {
    const pathExpression = rest[0]
    if (!pathExpression) {
      throw new IcodeError('缺少配置路径: icode config get <path>', {
        code: 'CONFIG_GET_PATH_REQUIRED',
        exitCode: 2
      })
    }

    const value = getValue(pathExpression)
    if (value === undefined) {
      logger.warn('配置不存在。')
      return
    }

    if (typeof value === 'object') {
      process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
    } else {
      process.stdout.write(`${value}\n`)
    }

    return
  }

  if (command === 'set') {
    const [pathExpression, rawValue] = rest
    if (!pathExpression || rawValue == null) {
      throw new IcodeError('缺少参数: icode config set <path> <value>', {
        code: 'CONFIG_SET_ARGUMENTS_REQUIRED',
        exitCode: 2
      })
    }

    const value = parseConfigValue(rawValue)
    setValue(pathExpression, value)
    logger.success(`已写入: ${pathExpression}`)
    return
  }

  if (command === 'delete') {
    const [pathExpression] = rest
    if (!pathExpression) {
      throw new IcodeError('缺少参数: icode config delete <path>', {
        code: 'CONFIG_DELETE_PATH_REQUIRED',
        exitCode: 2
      })
    }

    deleteValue(pathExpression)
    logger.success(`已删除: ${pathExpression}`)
    return
  }

  if (command === 'protect') {
    const [action, ...branches] = rest
    const repoRoot = await resolvePolicyRoot(parsed.values['repo-mode'])
    const currentPolicy = getRepoPolicy(repoRoot)
    const currentProtected = new Set((currentPolicy.protectedBranches || []).map((item) => item.trim()).filter(Boolean))

    if (action === 'list') {
      process.stdout.write(`${[...currentProtected].join('\n')}\n`)
      logger.info(`受保护分支作用仓库: ${repoRoot}`)
      return
    }

    if (action === 'add') {
      branches.forEach((branch) => {
        const normalized = branch.trim()
        if (normalized) {
          currentProtected.add(normalized)
        }
      })

      setRepoPolicy(repoRoot, {
        protectedBranches: [...currentProtected]
      })
      logger.success(`受保护分支已更新: ${[...currentProtected].join(', ')}`)
      return
    }

    if (action === 'remove') {
      branches.forEach((branch) => {
        currentProtected.delete(branch.trim())
      })

      setRepoPolicy(repoRoot, {
        protectedBranches: [...currentProtected]
      })
      logger.success(`受保护分支已更新: ${[...currentProtected].join(', ')}`)
      return
    }

    throw new IcodeError('protect 子命令仅支持: list | add | remove', {
      code: 'CONFIG_PROTECT_INVALID_ACTION',
      exitCode: 2
    })
  }

  throw new IcodeError(`未知 config 子命令: ${command}`, {
    code: 'CONFIG_UNKNOWN_SUBCOMMAND',
    exitCode: 2
  })
}
