const SPINNER_FRAMES = ['-', '\\', '|', '/']

// 判断当前进程是否适合渲染动态等待效果，输入为空，输出布尔值。
function canRenderSpinner() {
  return Boolean(process.stderr.isTTY) && process.env.ICODE_NO_SPINNER !== '1'
}

// 清理当前终端行，输入为空，输出为空，仅在 TTY 中生效。
function clearLine() {
  if (!canRenderSpinner()) {
    return
  }

  process.stderr.write('\r\x1b[2K')
}

// 执行异步任务时展示等待动画，输入展示文案和任务函数，输出任务结果。
export async function withSpinner(text, task) {
  if (!canRenderSpinner()) {
    return task()
  }

  let frameIndex = 0
  const render = () => {
    const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length]
    frameIndex += 1
    clearLine()
    process.stderr.write(`[icode] ${frame} ${text}`)
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
