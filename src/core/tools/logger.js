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

// Prefix every rendered line so multiline logs keep the same visible marker.
function print(stream, level, message) {
  const normalizedMessage = String(message ?? '')
  const formattedMessage = normalizedMessage
    .split('\n')
    .map((line) => `${level}${line}`)
    .join('\n')

  stream.write(`${formattedMessage}\n`)
}

export const logger = {
  // 按指定颜色渲染短文本，输入颜色名和文本，输出可直接拼进日志的 ANSI 字符串。
  color(color, message) {
    return colorize(color, String(message ?? ''))
  },

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
