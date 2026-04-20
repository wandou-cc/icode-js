#!/usr/bin/env node
import { handleCliError, main } from '../src/cli.js'

main().catch((error) => {
  handleCliError(error)
})
