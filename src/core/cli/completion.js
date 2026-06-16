import { spawnSync } from 'node:child_process'
import { listAiProfiles } from '../ai/config.js'

const REPO_MODE_VALUES = ['auto', 'strict']
const AI_FORMAT_VALUES = ['openai', 'anthropic', 'ollama']
const AI_OPTION_SCOPE_VALUES = ['commit', 'conflict', 'explain', 'push']
const AI_COMMIT_LANG_VALUES = ['zh', 'en']
const UNDO_MODE_VALUES = ['revert', 'soft', 'mixed', 'hard']
const UNDO_RECOVER_VALUES = ['continue', 'abort', 'keep']
const SHELL_VALUES = ['bash', 'zsh']
const CONFIG_PATH_VALUES = [
  'defaults.repoMode',
  'defaults.defaultMainBranches',
  'ai.activeProfile',
  'ai.profiles',
  'ai.options',
  'repositories'
]

const CODE_REVIEW_NODE = {
  options: [
    { long: '--base', valueSource: 'ref' },
    { long: '--head', valueSource: 'ref' },
    { long: '--focus', valueSource: 'text' },
    { long: '--profile', valueSource: 'ai-profile' },
    { long: '--repo-mode', valueSource: 'repo-mode' },
    { long: '--dump-response' },
    { long: '--help', short: '-h' }
  ]
}

const EXPLAIN_NODE = {
  options: [
    { long: '--base', valueSource: 'ref' },
    { long: '--head', valueSource: 'ref' },
    { long: '--profile', valueSource: 'ai-profile' },
    { long: '--repo-mode', valueSource: 'repo-mode' },
    { long: '--dump-response' },
    { long: '--help', short: '-h' }
  ]
}

const ROOT_COMPLETION_SPEC = {
  options: [
    { long: '--debug', short: '-d' },
    { long: '--help', short: '-h' }
  ],
  subcommands: {
    ai: {
      options: [{ long: '--help', short: '-h' }],
      subcommands: {
        commit: {
          options: [
            { long: '--apply' },
            { long: '--lang', valueSource: 'ai-commit-lang' },
            { long: '--profile', valueSource: 'ai-profile' },
            { long: '--repo-mode', valueSource: 'repo-mode' },
            { long: '--no-verify' },
            { long: '--yes', short: '-y' },
            { long: '--help', short: '-h' }
          ]
        },
        conflict: {
          options: [
            { long: '--profile', valueSource: 'ai-profile' },
            { long: '--repo-mode', valueSource: 'repo-mode' },
            { long: '--help', short: '-h' }
          ]
        },
        codereview: CODE_REVIEW_NODE,
        review: CODE_REVIEW_NODE,
        explain: EXPLAIN_NODE
      }
    },
    codereview: CODE_REVIEW_NODE,
    checkout: {
      positionals: [
        { valueSource: 'branch' },
        { valueSource: 'branch' }
      ],
      options: [
        { long: '--yes', short: '-y' },
        { long: '--push-origin' },
        { long: '--pull-main' },
        { long: '--repo-mode', valueSource: 'repo-mode' },
        { long: '--no-verify' },
        { long: '--help', short: '-h' }
      ]
    },
    ready: {
      options: [
        { long: '--repo-mode', valueSource: 'repo-mode' },
        { long: '--json' },
        { long: '--help', short: '-h' }
      ]
    },
    save: {
      options: [
        { long: '--message', short: '-m', valueSource: 'text' },
        { long: '--ai-commit' },
        { long: '--profile', valueSource: 'ai-profile' },
        { long: '--lang', valueSource: 'ai-commit-lang' },
        { long: '--dry-run' },
        { long: '--json' },
        { long: '--repo-mode', valueSource: 'repo-mode' },
        { long: '--no-verify' },
        { long: '--yes', short: '-y' },
        { long: '--help', short: '-h' }
      ]
    },
    push: {
      positionals: [{ valueSource: 'branch', repeat: true }],
      options: [
        { long: '--message', short: '-m', valueSource: 'text' },
        { long: '--yes', short: '-y' },
        { long: '--local-merge' },
        { long: '--remote-merge', short: '-r' },
        { long: '--dry-run' },
        { long: '--ai-commit' },
        { long: '--ai-profile', valueSource: 'ai-profile' },
        { long: '--help', short: '-h' },
        { long: '--pull-main' },
        { long: '--not-push-current' },
        { long: '--force-protected' },
        { long: '--repo-mode', valueSource: 'repo-mode' },
        { long: '--no-verify' }
      ]
    },
    sync: {
      positionals: [{ valueSource: 'branch', repeat: true }],
      options: [
        { long: '--all-local' },
        { long: '--merge-main' },
        { long: '--rebase' },
        { long: '--push' },
        { long: '--yes', short: '-y' },
        { long: '--repo-mode', valueSource: 'repo-mode' },
        { long: '--no-verify' },
        { long: '--help', short: '-h' }
      ]
    },
    clean: {
      options: [
        { long: '--merged-target', valueSource: 'branch' },
        { long: '--keep', valueSource: 'branch' },
        { long: '--remote' },
        { long: '--force' },
        { long: '--yes', short: '-y' },
        { long: '--repo-mode', valueSource: 'repo-mode' },
        { long: '--help', short: '-h' }
      ]
    },
    undo: {
      positionals: [{ valueSource: 'ref' }],
      options: [
        { long: '--mode', valueSource: 'undo-mode' },
        { long: '--ref', valueSource: 'ref' },
        { long: '--hash', valueSource: 'ref' },
        { long: '--recover', valueSource: 'undo-recover' },
        { long: '--json' },
        { long: '--yes', short: '-y' },
        { long: '--repo-mode', valueSource: 'repo-mode' },
        { long: '--help', short: '-h' }
      ]
    },
    migrate: {
      positionals: [
        { valueSource: 'branch' },
        { valueSource: 'branch' }
      ],
      options: [
        { long: '--interactive', short: '-i' },
        { long: '--range', valueSource: 'text' },
        { long: '--dry-run' },
        { long: '--json' },
        { long: '--push' },
        { long: '--yes', short: '-y' },
        { long: '--repo-mode', valueSource: 'repo-mode' },
        { long: '--no-verify' },
        { long: '--help', short: '-h' }
      ]
    },
    tag: {
      options: [
        { long: '--name', short: '-n', valueSource: 'text' },
        { long: '--message', short: '-m', valueSource: 'text' },
        { long: '--from', valueSource: 'ref' },
        { long: '--repo-mode', valueSource: 'repo-mode' },
        { long: '--no-verify' },
        { long: '--help', short: '-h' }
      ]
    },
    config: {
      options: [
        { long: '--repo-mode', valueSource: 'repo-mode' },
        { long: '--help', short: '-h' }
      ],
      subcommands: {
        list: {},
        get: {
          positionals: [{ valueSource: 'config-path' }]
        },
        set: {
          positionals: [
            { valueSource: 'config-path' },
            { valueSource: 'text' }
          ]
        },
        delete: {
          positionals: [{ valueSource: 'config-path' }]
        },
        ai: {
          subcommands: {
            list: {},
            show: {
              positionals: [{ valueSource: 'ai-profile' }]
            },
            set: {
              positionals: [{ valueSource: 'ai-profile' }],
              options: [
                { long: '--provider', valueSource: 'text' },
                { long: '--format', valueSource: 'ai-format' },
                { long: '--base-url', valueSource: 'text' },
                { long: '--api-key', valueSource: 'text' },
                { long: '--model', valueSource: 'text' },
                { long: '--temperature', valueSource: 'text' },
                { long: '--max-tokens', valueSource: 'text' },
                { long: '--headers', valueSource: 'text' },
                { long: '--request-body', valueSource: 'text' },
                { long: '--activate' }
              ]
            },
            options: {
              subcommands: {
                list: {},
                show: {
                  positionals: [{ valueSource: 'ai-option-scope' }]
                },
                set: {
                  positionals: [{ valueSource: 'ai-option-scope' }],
                  options: [
                    { long: '--json', valueSource: 'text' },
                    { long: '--replace' }
                  ]
                },
                remove: {
                  positionals: [{ valueSource: 'ai-option-scope' }]
                }
              },
              options: [{ long: '--help', short: '-h' }]
            },
            use: {
              positionals: [{ valueSource: 'ai-profile' }]
            },
            remove: {
              positionals: [{ valueSource: 'ai-profile' }]
            },
            test: {
              positionals: [{ valueSource: 'ai-profile' }]
            }
          },
          options: [{ long: '--help', short: '-h' }]
        },
        protect: {
          subcommands: {
            list: {},
            add: {
              positionals: [{ valueSource: 'branch', repeat: true }]
            },
            remove: {
              positionals: [{ valueSource: 'branch', repeat: true }]
            }
          }
        }
      }
    },
    doctor: {
      options: [
        { long: '--repo-mode', valueSource: 'repo-mode' },
        { long: '--json' },
        { long: '--help', short: '-h' }
      ]
    },
    explain: EXPLAIN_NODE,
    info: {
      options: [
        { long: '--repo-mode', valueSource: 'repo-mode' },
        { long: '--help', short: '-h' }
      ]
    },
    help: {},
    completion: {
      positionals: [{ valueSource: 'shell' }],
      options: [{ long: '--help', short: '-h' }]
    }
  }
}

/**
 * 生成当前输入上下文的补全候选项。
 * 输入为已确认的前置参数、当前正在补全的片段和可注入候选提供器，输出为去重后的字符串列表。
 */
export function getCompletionCandidates(previousWords = [], currentWord = '', dependencies = {}) {
  const providers = resolveCompletionProviders(dependencies)
  const context = walkCompletionContext(ROOT_COMPLETION_SPEC, previousWords)
  const inlineValueContext = resolveInlineValueContext(context.node, currentWord)

  if (inlineValueContext) {
    const candidates = resolveValueCandidates(inlineValueContext.option.valueSource, providers)
    return filterCandidates(candidates, inlineValueContext.query).map(
      (candidate) => `${inlineValueContext.prefix}${candidate}`
    )
  }

  if (context.pendingOption) {
    return filterCandidates(resolveValueCandidates(context.pendingOption.valueSource, providers), currentWord)
  }

  const candidates = []
  if (shouldSuggestSubcommands(context.node, context.positionalCount)) {
    candidates.push(...listSubcommandNames(context.node))
  }

  if (shouldSuggestOptions(currentWord)) {
    candidates.push(...listOptionFlags(context.node))
  }

  if (!currentWord.startsWith('-')) {
    candidates.push(...resolvePositionalCandidates(context.node, context.positionalCount, providers))
  }

  return filterCandidates(candidates, currentWord)
}

/**
 * 生成指定 shell 的补全脚本文本。
 * 输入为 shell 名称，输出为可直接 source 的补全脚本内容。
 */
export function renderCompletionScript(shellName) {
  const normalizedShell = String(shellName || '').trim().toLowerCase()

  if (normalizedShell === 'bash') {
    return renderBashCompletionScript()
  }

  if (normalizedShell === 'zsh') {
    return renderZshCompletionScript()
  }

  throw new Error(`不支持的 shell: ${shellName}`)
}

/**
 * 统一解析补全依赖，优先使用测试注入，默认走本地真实数据源。
 * 输入为可选依赖对象，输出为完整的候选提供器集合。
 */
function resolveCompletionProviders(dependencies = {}) {
  return {
    listBranchCandidates: dependencies.listBranchCandidates || listBranchCandidates,
    listRefCandidates: dependencies.listRefCandidates || listRefCandidates,
    listAiProfileCandidates: dependencies.listAiProfileCandidates || listAiProfileCandidates
  }
}

/**
 * 沿着命令树消费已确认参数，定位当前节点、待补全 option 和 positional 下标。
 * 输入为根节点与已确认参数数组，输出为补全上下文对象。
 */
function walkCompletionContext(rootNode, previousWords) {
  let node = rootNode
  let pendingOption = null
  let positionalCount = 0

  for (const word of previousWords) {
    if (pendingOption) {
      pendingOption = null
      continue
    }

    const inlineOption = resolveInlineOption(node, word)
    if (inlineOption) {
      continue
    }

    const option = findOption(node, word)
    if (option) {
      pendingOption = option.valueSource ? option : null
      continue
    }

    const subcommand = node.subcommands?.[word]
    if (subcommand) {
      node = subcommand
      positionalCount = 0
      pendingOption = null
      continue
    }

    positionalCount += 1
  }

  return {
    node,
    pendingOption,
    positionalCount
  }
}

/**
 * 识别 `--option=value` 形式的当前输入，并返回对应 option 与过滤前缀。
 * 输入为当前命令节点与当前词，输出为内联 value 上下文或 null。
 */
function resolveInlineValueContext(node, currentWord) {
  const separatorIndex = currentWord.indexOf('=')
  if (separatorIndex === -1) {
    return null
  }

  const optionToken = currentWord.slice(0, separatorIndex)
  const option = findOption(node, optionToken)
  if (!option || !option.valueSource) {
    return null
  }

  return {
    option,
    prefix: `${optionToken}=`,
    query: currentWord.slice(separatorIndex + 1)
  }
}

/**
 * 识别已确认参数里的 `--option=value`，用于避免错误地把它当作 positional。
 * 输入为当前命令节点与单个参数，输出为命中的 option 或 null。
 */
function resolveInlineOption(node, word) {
  const separatorIndex = word.indexOf('=')
  if (separatorIndex === -1) {
    return null
  }

  return findOption(node, word.slice(0, separatorIndex))
}

/**
 * 按当前节点查找长参数或短参数定义。
 * 输入为命令节点与待匹配 token，输出为 option 定义或 null。
 */
function findOption(node, token) {
  if (!token.startsWith('-')) {
    return null
  }

  for (const option of node.options || []) {
    if (option.long === token || option.short === token) {
      return option
    }
  }

  return null
}

/**
 * 判断当前上下文是否仍应优先展示子命令。
 * 输入为当前节点与已消费 positional 数量，输出为布尔值。
 */
function shouldSuggestSubcommands(node, positionalCount) {
  return Boolean(node.subcommands && positionalCount === 0)
}

/**
 * 判断当前词是否适合展示参数开关候选。
 * 输入为当前词，输出为布尔值。
 */
function shouldSuggestOptions(currentWord) {
  return currentWord === '' || currentWord.startsWith('-')
}

/**
 * 列出当前节点下可见子命令名称。
 * 输入为命令节点，输出为子命令名数组。
 */
function listSubcommandNames(node) {
  return Object.keys(node.subcommands || {})
}

/**
 * 列出当前节点下的长短参数名。
 * 输入为命令节点，输出为 flag 字符串数组。
 */
function listOptionFlags(node) {
  const flags = []

  for (const option of node.options || []) {
    if (option.long) {
      flags.push(option.long)
    }
    if (option.short) {
      flags.push(option.short)
    }
  }

  return flags
}

/**
 * 根据当前 positional 下标解析候选提供器。
 * 输入为命令节点、已消费 positional 数量和提供器集合，输出为候选数组。
 */
function resolvePositionalCandidates(node, positionalCount, providers) {
  const positionals = node.positionals || []
  if (!positionals.length) {
    return []
  }

  const spec = positionals[positionalCount] || positionals[positionals.length - 1]
  if (!spec || (!spec.repeat && positionalCount >= positionals.length)) {
    return []
  }

  return resolveValueCandidates(spec.valueSource, providers)
}

/**
 * 按 valueSource 解析动态或静态候选项。
 * 输入为 valueSource 名称与提供器集合，输出为字符串数组。
 */
function resolveValueCandidates(valueSource, providers) {
  if (!valueSource || valueSource === 'text') {
    return []
  }

  if (valueSource === 'repo-mode') {
    return REPO_MODE_VALUES
  }

  if (valueSource === 'ai-format') {
    return AI_FORMAT_VALUES
  }

  if (valueSource === 'ai-option-scope') {
    return AI_OPTION_SCOPE_VALUES
  }

  if (valueSource === 'ai-commit-lang') {
    return AI_COMMIT_LANG_VALUES
  }

  if (valueSource === 'undo-mode') {
    return UNDO_MODE_VALUES
  }

  if (valueSource === 'undo-recover') {
    return UNDO_RECOVER_VALUES
  }

  if (valueSource === 'shell') {
    return SHELL_VALUES
  }

  if (valueSource === 'config-path') {
    return CONFIG_PATH_VALUES
  }

  if (valueSource === 'branch') {
    return providers.listBranchCandidates()
  }

  if (valueSource === 'ref') {
    return providers.listRefCandidates()
  }

  if (valueSource === 'ai-profile') {
    return providers.listAiProfileCandidates()
  }

  return []
}

/**
 * 过滤、去重并保留与当前前缀匹配的候选项。
 * 输入为候选数组与当前前缀，输出为去重后的候选数组。
 */
function filterCandidates(candidates, currentWord) {
  const prefix = String(currentWord || '')
  const unique = new Set()

  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim()
    if (!normalized) {
      continue
    }
    if (prefix && !normalized.startsWith(prefix)) {
      continue
    }
    unique.add(normalized)
  }

  return [...unique]
}

/**
 * 读取当前仓库的分支候选项，失败时静默返回空数组。
 * 输入为空，输出为本地与远程分支名数组。
 */
function listBranchCandidates() {
  return listGitCandidates(['refs/heads', 'refs/remotes'])
}

/**
 * 读取当前仓库的 ref 候选项，失败时静默返回空数组。
 * 输入为空，输出为 HEAD、分支与 tag 名数组。
 */
function listRefCandidates() {
  return ['HEAD', ...listGitCandidates(['refs/heads', 'refs/remotes', 'refs/tags'])]
}

/**
 * 读取已配置的 AI profile 名称，失败时静默返回空数组。
 * 输入为空，输出为 profile 名称数组。
 */
function listAiProfileCandidates() {
  try {
    return listAiProfiles().map((item) => item.name)
  } catch {
    return []
  }
}

/**
 * 执行 `git for-each-ref` 并格式化为去重后的短 ref 名。
 * 输入为 ref 前缀列表，输出为 ref 名数组。
 */
function listGitCandidates(refPrefixes) {
  try {
    const result = spawnSync('git', ['for-each-ref', '--format=%(refname:short)', ...refPrefixes], {
      cwd: process.cwd(),
      encoding: 'utf8'
    })

    if (result.status !== 0) {
      return []
    }

    const unique = new Set()
    for (const line of String(result.stdout || '').split('\n')) {
      const candidate = line.trim()
      if (!candidate || candidate.endsWith('/HEAD')) {
        continue
      }
      unique.add(candidate)
    }

    return [...unique]
  } catch {
    return []
  }
}

/**
 * 生成 bash 补全脚本。
 * 输入为空，输出为可直接 source 的 bash 脚本文本。
 */
function renderBashCompletionScript() {
  return `# bash completion for icode
_icode_completion() {
  local current_word
  local index
  local -a previous_words=()

  COMPREPLY=()
  current_word="\${COMP_WORDS[COMP_CWORD]}"

  for ((index = 1; index < COMP_CWORD; index += 1)); do
    previous_words+=("\${COMP_WORDS[index]}")
  done

  if ! mapfile -t COMPREPLY < <(command icode __complete --current "$current_word" -- "\${previous_words[@]}"); then
    COMPREPLY=()
  fi
}

complete -o bashdefault -o default -F _icode_completion icode
`
}

/**
 * 生成 zsh 补全脚本。
 * 输入为空，输出为可直接 source 的 zsh 脚本文本。
 */
function renderZshCompletionScript() {
  return `#compdef icode
_icode_completion() {
  emulate -L zsh

  local current_word
  local index
  local -a previous_words
  local -a completions

  current_word="\${words[CURRENT]:-}"
  previous_words=()

  for ((index = 2; index < CURRENT; index += 1)); do
    previous_words+=("\${words[index]}")
  done

  completions=("\${(@f)\$(command icode __complete --current "$current_word" -- "\${previous_words[@]}")}")

  if (( \${#completions[@]} )); then
    compadd -- "\${completions[@]}"
    return 0
  fi

  _default
}

compdef _icode_completion icode
`
}
