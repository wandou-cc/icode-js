import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runCli } from '../src/cli.js'
import { resolveGitContext } from '../src/core/git/context.js'
import { runCommand } from '../src/core/commands/shell.js'

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

test('resolveGitContext rejects non-git directories without implicit init', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-cli-init-'))

  try {
    await assert.rejects(
      () => resolveGitContext({
        cwd: tempRoot
      }),
      (error) => error?.code === 'NOT_IN_GIT_REPO'
    )

    const result = await runCommand('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: tempRoot,
      allowFailure: true
    })

    assert.notEqual(result.exitCode, 0)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})
