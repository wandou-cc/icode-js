import assert from 'node:assert/strict'
import test from 'node:test'
import { logger } from '../src/core/tools/logger.js'

test('logger prefixes every line for multiline success output', () => {
  let captured = ''
  const originalWrite = process.stdout.write

  process.stdout.write = (chunk, encoding, callback) => {
    captured += chunk.toString()
    if (typeof encoding === 'function') {
      encoding()
    } else if (typeof callback === 'function') {
      callback()
    }
    return true
  }

  try {
    logger.success('第一行\n第二行')
  } finally {
    process.stdout.write = originalWrite
  }

  const prefix = '\x1b[32m[icode] \x1b[0m'
  assert.equal(captured, `${prefix}第一行\n${prefix}第二行\n`)
})
