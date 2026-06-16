import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

/**
 * 判断当前 stdin/stdout 是否连接到交互式终端。
 * 输入为空，输出为布尔值。
 */
function isInteractive() {
  return Boolean(stdin.isTTY && stdout.isTTY)
}

/**
 * 对外暴露交互终端判断，供工作流决定是否进入交互模式。
 * 输入为空，输出为布尔值。
 */
export function isInteractiveTerminal() {
  return isInteractive()
}

/**
 * 归一化 confirm 的默认值配置，兼容布尔值与 options.defaultValue 两种调用方式。
 * 输入为 confirm 第二参数，输出为布尔默认值。
 */
function resolveConfirmDefaultValue(optionsOrDefaultValue) {
  if (typeof optionsOrDefaultValue === 'boolean') {
    return optionsOrDefaultValue
  }

  if (optionsOrDefaultValue && typeof optionsOrDefaultValue === 'object') {
    return optionsOrDefaultValue.defaultValue === true
  }

  return false
}

/**
 * 读取确认输入并返回布尔结果；非交互环境直接返回默认值。
 * 输入为提示文案与默认值配置，输出为用户是否确认。
 */
export async function confirm(message, optionsOrDefaultValue = false) {
  const defaultValue = resolveConfirmDefaultValue(optionsOrDefaultValue)
  if (!isInteractive()) {
    return defaultValue
  }

  const rl = createInterface({ input: stdin, output: stdout })
  const suffix = defaultValue ? '[Y/n]' : '[y/N]'
  const answer = (await rl.question(`${message} ${suffix} `)).trim().toLowerCase()
  rl.close()

  if (!answer) {
    return defaultValue
  }

  if (['y', 'yes', '1', 'true', 'ok', 'sure', '是'].includes(answer)) {
    return true
  }

  if (['n', 'no', '0', 'false', '否'].includes(answer)) {
    return false
  }

  return defaultValue
}

/**
 * 读取一行文本输入；非交互环境直接返回默认值。
 * 输入为提示文案与默认值，输出为归一化后的文本。
 */
export async function input(message, defaultValue = '') {
  if (!isInteractive()) {
    return defaultValue
  }

  const rl = createInterface({ input: stdin, output: stdout })
  const answer = await rl.question(`${message}${defaultValue ? ` (${defaultValue})` : ''}: `)
  rl.close()
  const normalized = answer.trim()
  return normalized || defaultValue
}

/**
 * 在给定选项中返回单个值；非交互环境返回默认索引对应值。
 * 输入为提示文案、选项列表与默认索引，输出为选中的 value。
 */
export async function chooseOne(message, choices, defaultIndex = 0) {
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('chooseOne 需要至少一个可选项')
  }

  const safeDefaultIndex = Math.min(Math.max(defaultIndex, 0), choices.length - 1)
  if (!isInteractive()) {
    return choices[safeDefaultIndex].value
  }

  stdout.write(`${message}\n`)
  choices.forEach((choice, index) => {
    stdout.write(`  ${index + 1}. ${choice.label}\n`)
  })

  const rl = createInterface({ input: stdin, output: stdout })
  const answer = (await rl.question(`请选择 [${safeDefaultIndex + 1}]: `)).trim()
  rl.close()

  if (!answer) {
    return choices[safeDefaultIndex].value
  }

  const numeric = Number(answer)
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > choices.length) {
    return choices[safeDefaultIndex].value
  }

  return choices[numeric - 1].value
}

/**
 * 按选项顺序输出已选 value。
 * 输入为选项与已选集合，输出为稳定顺序的 value 数组。
 */
function collectSelectedValues(choices, selected, maxSelections) {
  return choices
    .map((choice) => choice.value)
    .filter((value) => selected.has(value))
    .slice(0, maxSelections)
}

/**
 * 使用旧版数字菜单进行多选，供不支持 raw mode 的终端回退。
 * 输入为多选上下文，输出为已选 value 数组或 null。
 */
async function chooseManyByNumberInput(message, choices, context) {
  const selected = new Set(context.selectedValues)
  const doneValue = '__prompt_done__'
  const cancelValue = '__prompt_cancel__'

  while (true) {
    const menuChoices = choices.map((choice) => ({
      value: choice.value,
      label: `${selected.has(choice.value) ? '[x]' : '[ ]'} ${choice.label}`
    }))
    menuChoices.push({
      value: doneValue,
      label: `${context.doneLabel}（已选 ${selected.size} 项）`
    })
    menuChoices.push({
      value: cancelValue,
      label: context.cancelLabel
    })

    const defaultChoiceValue = selected.size >= context.minSelections ? doneValue : choices[0].value
    const resolvedDefaultIndex = Math.max(0, menuChoices.findIndex((item) => item.value === defaultChoiceValue))
    const selectedAction = await chooseOne(message, menuChoices, resolvedDefaultIndex)

    if (selectedAction === cancelValue) {
      return null
    }

    if (selectedAction === doneValue) {
      if (selected.size < context.minSelections) {
        stdout.write(`至少需要选择 ${context.minSelections} 项。\n`)
        continue
      }
      return collectSelectedValues(choices, selected, context.maxSelections)
    }

    if (selected.has(selectedAction)) {
      selected.delete(selectedAction)
      continue
    }

    if (selected.size >= context.maxSelections) {
      stdout.write(`最多只能选择 ${context.maxSelections} 项。\n`)
      continue
    }

    selected.add(selectedAction)
  }
}

/**
 * 渲染 checkbox 多选列表。
 * 输入为当前光标和选择状态，输出为本次渲染占用的行数。
 */
function renderCheckboxChoices(message, choices, context, cursorIndex, selected, statusMessage, renderedLines) {
  if (renderedLines > 0) {
    stdout.write(`\x1b[${renderedLines}F`)
    stdout.write('\x1b[J')
  }

  const lines = [
    message,
    `↑/↓ 移动，Space 选中/取消，Enter ${context.doneLabel}，q ${context.cancelLabel}（已选 ${selected.size} 项）`
  ]

  if (statusMessage) {
    lines.push(statusMessage)
  }

  choices.forEach((choice, index) => {
    const cursor = index === cursorIndex ? '>' : ' '
    const checkbox = selected.has(choice.value) ? '[x]' : '[ ]'
    lines.push(`${cursor} ${checkbox} ${choice.label}`)
  })

  stdout.write(`${lines.join('\n')}\n`)
  return lines.length
}

/**
 * 使用键盘 checkbox 进行多选。
 * 输入为多选上下文，输出为已选 value 数组或 null。
 */
function chooseManyByCheckbox(message, choices, context) {
  const selected = new Set(context.selectedValues)
  let cursorIndex = 0
  let renderedLines = 0
  let statusMessage = ''
  let closed = false
  const wasRaw = stdin.isRaw === true

  return new Promise((resolve) => {
    const finish = (value) => {
      if (closed) {
        return
      }

      closed = true
      stdin.off('data', onData)
      stdin.setRawMode(wasRaw)
      stdin.pause()
      resolve(value)
    }

    const render = () => {
      renderedLines = renderCheckboxChoices(message, choices, context, cursorIndex, selected, statusMessage, renderedLines)
    }

    const moveCursor = (offset) => {
      statusMessage = ''
      cursorIndex = (cursorIndex + offset + choices.length) % choices.length
      render()
    }

    const toggleCurrent = () => {
      statusMessage = ''
      const currentValue = choices[cursorIndex].value
      if (selected.has(currentValue)) {
        selected.delete(currentValue)
        render()
        return
      }

      if (selected.size >= context.maxSelections) {
        statusMessage = `最多只能选择 ${context.maxSelections} 项。`
        render()
        return
      }

      selected.add(currentValue)
      render()
    }

    const complete = () => {
      if (selected.size < context.minSelections) {
        statusMessage = `至少需要选择 ${context.minSelections} 项。`
        render()
        return
      }
      finish(collectSelectedValues(choices, selected, context.maxSelections))
    }

    function onData(chunk) {
      const input = chunk.toString('utf8')

      for (let index = 0; index < input.length; index += 1) {
        if (closed) {
          return
        }

        const sequence = input.slice(index, index + 3)
        if (sequence === '\u001b[A') {
          moveCursor(-1)
          index += 2
          continue
        }

        if (sequence === '\u001b[B') {
          moveCursor(1)
          index += 2
          continue
        }

        const key = input[index]
        if (key === '\u0003' || key === '\u001b' || key.toLowerCase() === 'q') {
          finish(null)
          return
        }

        if (key === '\r' || key === '\n') {
          complete()
          continue
        }

        if (key === ' ') {
          toggleCurrent()
          continue
        }

        if (key.toLowerCase() === 'k') {
          moveCursor(-1)
          continue
        }

        if (key.toLowerCase() === 'j') {
          moveCursor(1)
        }
      }
    }

    stdin.setRawMode(true)
    stdin.resume()
    stdin.on('data', onData)
    render()
  })
}

/**
 * 在给定选项中进行多选；非交互环境返回默认值集合。
 * 输入为提示文案、选项列表与多选配置，输出为选中的 value 数组或 null。
 */
export async function chooseMany(message, choices, options = {}) {
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('chooseMany 需要至少一个可选项')
  }

  const parsedMin = Number(options.minSelections ?? 0)
  const parsedMax = Number(options.maxSelections ?? choices.length)
  const minSelections = Number.isFinite(parsedMin) ? Math.max(0, Math.floor(parsedMin)) : 0
  const maxCap = Number.isFinite(parsedMax) ? Math.max(0, Math.floor(parsedMax)) : choices.length
  const maxSelections = Math.max(minSelections, Math.min(choices.length, maxCap))
  const doneLabel = options.doneLabel || '完成选择'
  const cancelLabel = options.cancelLabel || '取消'
  const defaultValues = Array.isArray(options.defaultValues) ? options.defaultValues : []
  const defaultSet = new Set(defaultValues)
  const selectedValues = choices
    .map((choice) => choice.value)
    .filter((value) => defaultSet.has(value))
    .slice(0, maxSelections)

  if (!isInteractive()) {
    return selectedValues
  }

  const context = {
    minSelections,
    maxSelections,
    doneLabel,
    cancelLabel,
    selectedValues
  }

  if (typeof stdin.setRawMode !== 'function') {
    return chooseManyByNumberInput(message, choices, context)
  }

  return chooseManyByCheckbox(message, choices, context)
}
