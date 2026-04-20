import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fetchLatestPublishedVersion,
  hasNewerVersion,
  notifyIfCliUpdateAvailable
} from '../src/core/update-notifier.js'

test('hasNewerVersion returns true only when latest version is higher', () => {
  assert.equal(hasNewerVersion('3.0.4', '3.0.5'), true)
  assert.equal(hasNewerVersion('3.0.4', '3.1.0'), true)
  assert.equal(hasNewerVersion('3.0.4', '3.0.4'), false)
  assert.equal(hasNewerVersion('3.0.4', '2.9.9'), false)
})

test('fetchLatestPublishedVersion parses npm json output', async () => {
  const latestVersion = await fetchLatestPublishedVersion({
    packageName: '@icode-js/icode',
    runner: async () => ({
      exitCode: 0,
      stdout: '"3.1.0"\n',
      stderr: ''
    })
  })

  assert.equal(latestVersion, '3.1.0')
})

test('notifyIfCliUpdateAvailable warns when npm has newer version', async () => {
  const warnings = []

  const result = await notifyIfCliUpdateAvailable({
    packageName: '@icode-js/icode',
    currentVersion: '3.0.4',
    runner: async () => ({
      exitCode: 0,
      stdout: '"3.1.0"\n',
      stderr: ''
    }),
    warn: (message) => {
      warnings.push(message)
    }
  })

  assert.equal(result.notified, true)
  assert.deepEqual(warnings, [
    '发现新版本可用: 3.0.4 -> 3.1.0',
    '更新命令: npm i -g @icode-js/icode@latest'
  ])
})

test('notifyIfCliUpdateAvailable stays silent when update check fails', async () => {
  const warnings = []

  const result = await notifyIfCliUpdateAvailable({
    packageName: '@icode-js/icode',
    currentVersion: '3.0.4',
    runner: async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'network error'
    }),
    warn: (message) => {
      warnings.push(message)
    }
  })

  assert.equal(result.notified, false)
  assert.deepEqual(warnings, [])
})
