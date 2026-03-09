#!/usr/bin/env node
import('../src/cli.js').catch((error) => {
  const message = error?.message || String(error)
  console.error(`\x1b[31m[icode] ${message}\x1b[0m`)
  process.exit(error?.exitCode || 1)
})
