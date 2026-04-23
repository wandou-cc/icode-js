import assert from 'node:assert/strict'
import test from 'node:test'
import { IcodeError } from '../src/core/errors.js'
import { resolveUndoWorkflowOptions } from '../src/commands/undo.js'

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
    yes: true,
    repoMode: 'strict'
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
