import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runCommand } from '../src/core/shell.js'
import { resolveGitContext } from '../src/core/git-context.js'

test('git-context supports parent repository inheritance in auto mode', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-repo-test-'))
  process.env.ICODE_CONFIG_PATH = path.join(tempRoot, 'icode.config.json')
  await runCommand('git', ['init'], { cwd: tempRoot })

  const childPath = path.join(tempRoot, 'packages', 'app')
  fs.mkdirSync(childPath, { recursive: true })

  const context = await resolveGitContext({
    cwd: childPath,
    repoMode: 'auto'
  })

  assert.equal(fs.realpathSync(context.topLevelPath), fs.realpathSync(tempRoot))
  assert.equal(context.inheritedFromParent, true)
  delete process.env.ICODE_CONFIG_PATH
})

test('git-context strict mode blocks parent repository inheritance', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-repo-test-'))
  process.env.ICODE_CONFIG_PATH = path.join(tempRoot, 'icode.config.json')
  await runCommand('git', ['init'], { cwd: tempRoot })

  const childPath = path.join(tempRoot, 'packages', 'app')
  fs.mkdirSync(childPath, { recursive: true })

  await assert.rejects(
    resolveGitContext({
      cwd: childPath,
      repoMode: 'strict'
    }),
    (error) => error?.code === 'PARENT_REPO_INHERITED'
  )
  delete process.env.ICODE_CONFIG_PATH
})
