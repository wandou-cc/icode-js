import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { IcodeError } from '../src/core/errors.js'
import { runCommand } from '../src/core/commands/shell.js'
import { resolveUndoWorkflowOptions } from '../src/commands/undo.js'
import { runUndoWorkflow } from '../src/workflows/undo-workflow.js'

test('undo options accept commit hash from --hash', () => {
  const options = resolveUndoWorkflowOptions(
    {
      mode: 'revert',
      hash: 'a1b2c3d',
      yes: true,
      'repo-mode': 'strict'
    },
    []
  )

  assert.deepEqual(options, {
    mode: 'revert',
    ref: 'a1b2c3d',
    recover: undefined,
    json: false,
    silentLog: false,
    yes: true,
    repoMode: 'strict'
  })
})

test('undo options enable silent log when json is requested', () => {
  const options = resolveUndoWorkflowOptions(
    {
      mode: 'revert',
      ref: 'HEAD',
      json: true,
      yes: true
    },
    []
  )

  assert.deepEqual(options, {
    mode: 'revert',
    ref: 'HEAD',
    recover: undefined,
    json: true,
    silentLog: true,
    yes: true,
    repoMode: 'auto'
  })
})

test('undo options accept commit hash from positional ref', () => {
  const options = resolveUndoWorkflowOptions(
    {
      mode: 'hard',
      yes: true
    },
    ['a1b2c3d']
  )

  assert.deepEqual(options, {
    mode: 'hard',
    ref: 'a1b2c3d',
    recover: undefined,
    json: false,
    silentLog: false,
    yes: true,
    repoMode: 'auto'
  })
})

test('undo options reject conflicting ref inputs', () => {
  assert.throws(
    () => resolveUndoWorkflowOptions({ ref: 'HEAD~1', hash: 'a1b2c3d' }, []),
    (error) => error instanceof IcodeError && error.code === 'UNDO_REF_CONFLICT'
  )
})

test('undo options reject multiple positional refs', () => {
  assert.throws(
    () => resolveUndoWorkflowOptions({}, ['a1b2c3d', 'HEAD~1']),
    (error) => error instanceof IcodeError && error.code === 'UNDO_POSITIONAL_INVALID'
  )
})

test('undo workflow can abort pending merge', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-undo-workflow-test-'))
  const repoPath = path.join(tempRoot, 'repo')

  try {
    fs.mkdirSync(repoPath, { recursive: true })
    await runCommand('git', ['init'], { cwd: repoPath })
    await runCommand('git', ['config', 'user.email', 'test@example.com'], { cwd: repoPath })
    await runCommand('git', ['config', 'user.name', 'test'], { cwd: repoPath })
    fs.writeFileSync(path.join(repoPath, 'conflict.txt'), 'base\n', 'utf8')
    await runCommand('git', ['add', '-A'], { cwd: repoPath })
    await runCommand('git', ['commit', '-m', 'chore: init'], { cwd: repoPath })
    const defaultBranch = (await runCommand('git', ['branch', '--show-current'], { cwd: repoPath })).stdout.trim()

    await runCommand('git', ['checkout', '-b', 'other'], { cwd: repoPath })
    fs.writeFileSync(path.join(repoPath, 'conflict.txt'), 'other\n', 'utf8')
    await runCommand('git', ['commit', '-am', 'feat: other change'], { cwd: repoPath })

    await runCommand('git', ['checkout', defaultBranch], { cwd: repoPath })
    fs.writeFileSync(path.join(repoPath, 'conflict.txt'), 'main\n', 'utf8')
    await runCommand('git', ['commit', '-am', 'feat: main change'], { cwd: repoPath })
    await runCommand('git', ['merge', 'other'], { cwd: repoPath, allowFailure: true })

    const result = await runUndoWorkflow({
      cwd: repoPath,
      repoMode: 'auto',
      yes: true,
      recover: 'abort',
      silentLog: true
    })

    const mergeHead = await runCommand('git', ['rev-parse', '--verify', 'MERGE_HEAD'], {
      cwd: repoPath,
      allowFailure: true
    })
    const status = await runCommand('git', ['status', '--short'], { cwd: repoPath })

    assert.equal(result.resolvedOperation, 'merge')
    assert.equal(result.recoverAction, 'abort')
    assert.notEqual(mergeHead.exitCode, 0)
    assert.equal(status.stdout.trim(), '')
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})
