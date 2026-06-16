import assert from 'node:assert/strict'
import test from 'node:test'
import { withSpinner } from '../src/core/tools/loading.js'

// 临时启用 TTY spinner 并捕获 stderr，输入为空，输出捕获结果和恢复函数。
function captureSpinnerOutput() {
  const originalIsTTY = process.stderr.isTTY
  const originalWrite = process.stderr.write
  const originalNoSpinner = process.env.ICODE_NO_SPINNER
  const writes = []

  Object.defineProperty(process.stderr, 'isTTY', {
    value: true,
    configurable: true
  })
  delete process.env.ICODE_NO_SPINNER
  process.stderr.write = (chunk, encoding, callback) => {
    writes.push(String(chunk))
    if (typeof encoding === 'function') {
      encoding()
    } else if (typeof callback === 'function') {
      callback()
    }
    return true
  }

  return {
    writes,
    restore() {
      process.stderr.write = originalWrite
      Object.defineProperty(process.stderr, 'isTTY', {
        value: originalIsTTY,
        configurable: true
      })
      if (originalNoSpinner == null) {
        delete process.env.ICODE_NO_SPINNER
        return
      }
      process.env.ICODE_NO_SPINNER = originalNoSpinner
    }
  }
}

// 等待指定毫秒数，输入毫秒，输出 Promise。
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

test('withSpinner clears the terminal line before each render', async () => {
  const captured = captureSpinnerOutput()

  try {
    await withSpinner('等待响应', async () => {
      await delay(100)
    })
  } finally {
    captured.restore()
  }

  const renderCount = captured.writes.filter((line) => line.includes('等待响应')).length
  const clearCount = captured.writes.filter((line) => line === '\r\x1b[2K').length

  assert.ok(renderCount >= 1)
  assert.ok(clearCount >= renderCount)
})
