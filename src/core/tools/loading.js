const SPINNER_FRAMES = ['-', '\\', '|', '/']

function canRenderSpinner() {
  return Boolean(process.stderr.isTTY) && process.env.ICODE_NO_SPINNER !== '1'
}

function clearLine() {
  if (!canRenderSpinner()) {
    return
  }

  process.stderr.write('\r\x1b[2K')
}

export async function withSpinner(text, task) {
  if (!canRenderSpinner()) {
    return task()
  }

  let frameIndex = 0
  const render = () => {
    const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length]
    frameIndex += 1
    process.stderr.write(`\r[icode] ${frame} ${text}`)
  }

  render()
  const timer = setInterval(render, 80)

  try {
    return await task()
  } finally {
    clearInterval(timer)
    clearLine()
  }
}
