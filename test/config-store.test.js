import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  deleteValue,
  getConfigFilePath,
  getPlatformConfig,
  getRepoPolicy,
  readConfig,
  setPlatformConfig,
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
    protectedBranches: ['main', 'release'],
    remoteMerge: {
      enabled: true,
      projectUrl: 'https://gitlab.example.com/group/project'
    }
  })
  const policy = getRepoPolicy('/tmp/my-repo')
  assert.deepEqual(policy.protectedBranches.sort(), ['main', 'release'])
  assert.equal(policy.remoteMerge.enabled, true)
  assert.equal(policy.remoteMerge.projectUrl, 'https://gitlab.example.com/group/project')

  setPlatformConfig('remoteMerge', {
    provider: 'gitlab',
    apiKey: 'platform_key'
  })
  const platformConfig = getPlatformConfig('remoteMerge')
  assert.equal(platformConfig.provider, 'gitlab')
  assert.equal(platformConfig.apiKey, 'platform_key')

  const defaultPolicy = getRepoPolicy('/tmp/default-repo')
  assert.equal(defaultPolicy.remoteMerge.enabled, true)
  assert.equal(defaultPolicy.remoteMerge.projectUrl, '')

  deleteValue('defaults.repoMode')
  const afterDelete = readConfig()
  assert.equal(afterDelete.defaults.repoMode, 'auto')

  delete process.env.ICODE_CONFIG_PATH
})
