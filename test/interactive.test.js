import assert from 'node:assert/strict'
import test from 'node:test'
import { chooseMany } from '../src/core/tools/interactive.js'

test('chooseMany returns default selections in non-interactive mode', async () => {
  const result = await chooseMany(
    'pick items',
    [
      { label: 'A', value: 'a' },
      { label: 'B', value: 'b' },
      { label: 'C', value: 'c' }
    ],
    {
      defaultValues: ['c', 'a'],
      maxSelections: 1
    }
  )

  assert.deepEqual(result, ['a'])
})
