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

  const selected = new Set(selectedValues)
  const doneValue = '__prompt_done__'
  const cancelValue = '__prompt_cancel__'

  while (true) {
    const menuChoices = choices.map((choice) => ({
      value: choice.value,
      label: `${selected.has(choice.value) ? '[x]' : '[ ]'} ${choice.label}`
    }))
    menuChoices.push({
      value: doneValue,
      label: `${doneLabel}（已选 ${selected.size} 项）`
    })
    menuChoices.push({
      value: cancelValue,
      label: cancelLabel
    })

    const defaultChoiceValue = selected.size >= minSelections ? doneValue : choices[0].value
    const resolvedDefaultIndex = Math.max(0, menuChoices.findIndex((item) => item.value === defaultChoiceValue))
    const selectedAction = await chooseOne(message, menuChoices, resolvedDefaultIndex)

    if (selectedAction === cancelValue) {
      return null
    }

    if (selectedAction === doneValue) {
      if (selected.size < minSelections) {
        stdout.write(`至少需要选择 ${minSelections} 项。\n`)
        continue
      }
      return choices
        .map((choice) => choice.value)
        .filter((value) => selected.has(value))
        .slice(0, maxSelections)
    }

    if (selected.has(selectedAction)) {
      selected.delete(selectedAction)
      continue
    }

    if (selected.size >= maxSelections) {
      stdout.write(`最多只能选择 ${maxSelections} 项。\n`)
      continue
    }

    selected.add(selectedAction)
  }
}
