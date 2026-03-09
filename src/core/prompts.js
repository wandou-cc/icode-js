import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

function isInteractive() {
  return Boolean(stdin.isTTY && stdout.isTTY)
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
