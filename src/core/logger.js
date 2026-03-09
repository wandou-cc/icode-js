const COLORS = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
}

let verboseEnabled = process.env.ICODE_LOG_LEVEL === 'verbose'

function colorize(color, message) {
  return `${COLORS[color] || ''}${message}${COLORS.reset}`
}

function print(stream, level, message) {
  stream.write(`${level}${message}\n`)
}

export const logger = {
  setVerbose(enabled) {
    verboseEnabled = Boolean(enabled)
  },

  info(message) {
    print(process.stdout, colorize('cyan', '[icode] '), `${message}`)
  },

  success(message) {
    print(process.stdout, colorize('green', '[icode] '), `${message}`)
  },

  warn(message) {
    print(process.stderr, colorize('yellow', '[icode] '), `${message}`)
  },

  error(message) {
    print(process.stderr, colorize('red', '[icode] '), `${message}`)
  },

  debug(message) {
    if (!verboseEnabled) {
      return
    }

    print(process.stdout, colorize('gray', '[icode:debug] '), `${message}`)
  }
}
