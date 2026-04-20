import assert from 'node:assert/strict'
import test from 'node:test'
import { runCli } from '../src/cli.js'

test('runCli calls update notifier after command succeeds', async () => {
  let commandCalled = false
  let notifierCalled = false

  const exitCode = await runCli(['info'], {
    commands: {
      info: async () => {
        commandCalled = true
      }
    },
    notifyIfCliUpdateAvailable: async () => {
      notifierCalled = true
    }
  })

  assert.equal(exitCode, 0)
  assert.equal(commandCalled, true)
  assert.equal(notifierCalled, true)
})

test('runCli does not call update notifier for help command', async () => {
  let notifierCalled = false

  const exitCode = await runCli(['help'], {
    commands: {
      help: async () => {}
    },
    notifyIfCliUpdateAvailable: async () => {
      notifierCalled = true
    }
  })

  assert.equal(exitCode, 0)
  assert.equal(notifierCalled, false)
})

test('runCli does not call update notifier for completion command', async () => {
  let notifierCalled = false

  const exitCode = await runCli(['completion'], {
    commands: {
      completion: async () => {}
    },
    notifyIfCliUpdateAvailable: async () => {
      notifierCalled = true
    }
  })

  assert.equal(exitCode, 0)
  assert.equal(notifierCalled, false)
})

test('runCli does not call update notifier for hidden completion command', async () => {
  let notifierCalled = false

  const exitCode = await runCli(['__complete'], {
    commands: {
      __complete: async () => {}
    },
    notifyIfCliUpdateAvailable: async () => {
      notifierCalled = true
    }
  })

  assert.equal(exitCode, 0)
  assert.equal(notifierCalled, false)
})
