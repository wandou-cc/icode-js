import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

function isInteractive() {
  return Boolean(stdin.isTTY && stdout.isTTY)
}

export function isInteractiveTerminal() {
  return isInteractive()
}

export async function confirm(message, defaultValue = true) {
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

  if (['y', 'yes'].includes(answer)) {
    return true
  }

  if (['n', 'no'].includes(answer)) {
    return false
  }

  return defaultValue
}

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
    const defaultIndex = Math.max(0, menuChoices.findIndex((item) => item.value === defaultChoiceValue))
    const selectedAction = await chooseOne(`${message}`, menuChoices, defaultIndex)

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
