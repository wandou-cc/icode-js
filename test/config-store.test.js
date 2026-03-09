import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  deleteValue,
  getConfigFilePath,
  getRepoPolicy,
  readConfig,
  setRepoPolicy,
  setValue
} from '../src/core/config-store.js'

test('config-store read/write basic flow', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-config-test-'))
  const configPath = path.join(tempRoot, 'config.json')

  process.env.ICODE_CONFIG_PATH = configPath

  const initial = readConfig()
  assert.equal(initial.version, 1)
  assert.equal(getConfigFilePath(), configPath)

  setValue('defaults.repoMode', 'strict')
  const afterSet = readConfig()
  assert.equal(afterSet.defaults.repoMode, 'strict')

  setRepoPolicy('/tmp/my-repo', {
    protectedBranches: ['main', 'release']
  })
  const policy = getRepoPolicy('/tmp/my-repo')
  assert.deepEqual(policy.protectedBranches.sort(), ['main', 'release'])

  deleteValue('defaults.repoMode')
  const afterDelete = readConfig()
  assert.equal(afterDelete.defaults.repoMode, 'auto')

  delete process.env.ICODE_CONFIG_PATH
})
