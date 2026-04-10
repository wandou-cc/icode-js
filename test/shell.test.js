import assert from 'node:assert/strict'
import test from 'node:test'
import { runCommand } from '../src/core/shell.js'

test('runCommand includes stderr in command failure message', async () => {
  await assert.rejects(
    () =>
      runCommand(
        process.execPath,
        ['-e', 'process.stderr.write(process.env.ICODE_TEST_STDERR); process.exit(128)'],
        {
          env: {
            ...process.env,
            ICODE_TEST_STDERR: 'fatal: fetch failed\npermission denied\n'
          }
        }
      ),
    (error) => {
      assert.equal(error.code, 'COMMAND_EXEC_ERROR')
      assert.match(error.message, /fatal: fetch failed/)
      assert.match(error.message, /permission denied/)
      return true
    }
  )
})
