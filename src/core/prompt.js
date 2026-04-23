import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

function isAffirmative(answer) {
  const normalized = String(answer || '').trim().toLowerCase()
  return ['y', 'yes', '1', 'true', 'ok', 'sure', '是'].includes(normalized)
}

export async function confirm(message, options = {}) {
  const { defaultValue = false } = options
  const suffix = defaultValue ? ' [Y/n] ' : ' [y/N] '
  const rl = readline.createInterface({ input, output })

  try {
    const answer = await rl.question(`${message}${suffix}`)
    const normalized = String(answer || '').trim()
    if (!normalized) {
      return defaultValue
    }

    return isAffirmative(normalized)
  } finally {
    rl.close()
  }
}
