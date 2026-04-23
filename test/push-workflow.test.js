import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runCommand } from '../src/core/shell.js'
import { getRepoPolicy, setPlatformConfig, setRepoPolicy } from '../src/core/config-store.js'
import { upsertAiProfile, useAiProfile } from '../src/core/ai-config.js'
import { runPushWorkflow } from '../src/workflows/push-workflow.js'
import { GitService } from '../src/core/git-service.js'

async function git(cwd, args, options = {}) {
  return runCommand('git', args, { cwd, ...options })
}

async function gitStdout(cwd, args) {
  const result = await git(cwd, args)
  return result.stdout.trim()
}

async function initRepo(repoPath) {
  fs.mkdirSync(repoPath, { recursive: true })
  await git(repoPath, ['init'])
  await git(repoPath, ['config', 'user.email', 'test@example.com'])
  await git(repoPath, ['config', 'user.name', 'test'])
}

async function writeAndCommit(repoPath, fileName, content, message) {
  fs.writeFileSync(path.join(repoPath, fileName), content, 'utf8')
  await git(repoPath, ['add', '-A'])
  await git(repoPath, ['commit', '-m', message])
}

async function createRemoteMergeFixture(options = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icode-push-workflow-test-'))
  const remotePath = path.join(tempRoot, 'remote.git')
  const repoPath = path.join(tempRoot, 'repo')

  await git(tempRoot, ['init', '--bare', remotePath])
  await initRepo(repoPath)
  await writeAndCommit(repoPath, 'shared.txt', 'base\n', 'chore: init')

  const defaultBranch = await gitStdout(repoPath, ['branch', '--show-current'])
  await git(repoPath, ['remote', 'add', 'origin', remotePath])
  await git(repoPath, ['push', '-u', 'origin', defaultBranch])

  await git(repoPath, ['checkout', '-b', 'test'])
  await writeAndCommit(repoPath, 'target.txt', 'target\n', 'feat: target branch commit')
  await git(repoPath, ['push', '-u', 'origin', 'test'])

  await git(repoPath, ['checkout', defaultBranch])
  await git(repoPath, ['checkout', '-b', 'source'])
  await writeAndCommit(repoPath, 'source.txt', 'source\n', 'feat: source branch commit')

  return {
    remotePath,
    repoPath
  }
}

async function createRemoteTargetBranch(repoPath, branchName, fileName) {
  const defaultBranch = await gitStdout(repoPath, ['branch', '--show-current'])
  await git(repoPath, ['checkout', '-b', branchName, defaultBranch])
  await writeAndCommit(repoPath, fileName, `${branchName}\n`, `feat: ${branchName} branch commit`)
  await git(repoPath, ['push', '-u', 'origin', branchName])
  await git(repoPath, ['checkout', 'source'])
}

async function resolveRepoRoot(repoPath) {
  const result = await git(repoPath, ['rev-parse', '--show-toplevel'])
  return result.stdout.trim()
}

test('push-workflow uses local merge strategy by default for target branches', async () => {
  const fixture = await createRemoteMergeFixture()

  const result = await runPushWorkflow({
    cwd: fixture.repoPath,
    targetBranches: ['test'],
    yes: true,
    repoMode: 'auto'
  })

  assert.deepEqual(result.summary, [
    { branch: 'source', status: 'pushed' },
    { branch: 'test', status: 'merged-and-pushed' }
  ])
})

test('push-workflow with ai-commit commits and pushes untracked files without manual git add', async () => {
  const fixture = await createRemoteMergeFixture()
  process.env.ICODE_CONFIG_PATH = path.join(path.dirname(fixture.repoPath), 'config.json')
  const originalFetch = global.fetch

  try {
    fs.writeFileSync(path.join(fixture.repoPath, 'new-file.txt'), 'hello push workflow\n', 'utf8')

    upsertAiProfile('local', {
      provider: 'openai',
      format: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini'
    })
    useAiProfile('local')

    global.fetch = async () => ({
      ok: true,
      status: 200,
      headers: {
        forEach() {}
      },
      async text() {
        return JSON.stringify({
          choices: [
            {
              message: {
                content: '{"type":"feat","scope":"push","subject":"commit untracked file","body":""}'
              }
            }
          ]
        })
      }
    })

    const result = await runPushWorkflow({
      cwd: fixture.repoPath,
      yes: true,
      aiCommit: true,
      aiProfile: 'local',
      repoMode: 'auto'
    })

    assert.deepEqual(result.summary, [
      { branch: 'source', status: 'pushed' }
    ])

    const headFiles = await git(fixture.repoPath, ['show', '--name-only', '--format=', 'HEAD'])
    assert.match(headFiles.stdout, /new-file\.txt/)

    const remoteHeadFiles = await git(fixture.repoPath, ['show', '--name-only', '--format=', 'origin/source'])
    assert.match(remoteHeadFiles.stdout, /new-file\.txt/)

    const status = await git(fixture.repoPath, ['status', '--short'])
    assert.equal(status.stdout.trim(), '')
  } finally {
    global.fetch = originalFetch
    delete process.env.ICODE_CONFIG_PATH
  }
})

test('push-workflow remote merge pauses with clear conflict reason', async () => {
  const fixture = await createRemoteMergeFixture()
  const originalFetch = global.fetch
  const originalConfigPath = process.env.ICODE_CONFIG_PATH
  const originalGetRemoteUrl = GitService.prototype.getRemoteUrl

  try {
    const repoRoot = await resolveRepoRoot(fixture.repoPath)
    process.env.ICODE_CONFIG_PATH = path.join(path.dirname(fixture.repoPath), 'remote-merge-config.json')
    setRepoPolicy(repoRoot, {
      remoteMerge: {
        enabled: true,
        projectUrl: 'https://gitlab.example.com/group/project'
      }
    })
    setPlatformConfig('remoteMerge', {
      provider: 'gitlab',
      apiKey: 'rm_test_key'
    })
    GitService.prototype.getRemoteUrl = async () => 'git@gitlab.example.com:group/project.git'

    global.fetch = async (url) => {
      assert.equal(url, 'https://gitlab.example.com/api/v4/projects/group%2Fproject/merge_requests')
      return ({
      ok: false,
      status: 409,
      async text() {
        return JSON.stringify({
          reason: 'shared.txt 存在内容冲突'
        })
      }
      })
    }

    await assert.rejects(
      () => runPushWorkflow({
        cwd: fixture.repoPath,
        targetBranches: ['test'],
        yes: true,
        repoMode: 'auto',
        remoteMerge: true
      }),
      (error) => {
        assert.equal(error.code, 'PUSH_REMOTE_MERGE_PAUSED')
        assert.match(error.message, /远程合并冲突\(create\): shared.txt 存在内容冲突/)
        return true
      }
    )

    const currentBranch = await gitStdout(fixture.repoPath, ['branch', '--show-current'])
    assert.equal(currentBranch, 'source')
  } finally {
    GitService.prototype.getRemoteUrl = originalGetRemoteUrl
    global.fetch = originalFetch
    if (originalConfigPath == null) {
      delete process.env.ICODE_CONFIG_PATH
    } else {
      process.env.ICODE_CONFIG_PATH = originalConfigPath
    }
  }
})

test('push-workflow remote merge uses gitlab fixed api endpoint from origin', async () => {
  const fixture = await createRemoteMergeFixture()
  const originalFetch = global.fetch
  const originalConfigPath = process.env.ICODE_CONFIG_PATH
  const originalGetRemoteUrl = GitService.prototype.getRemoteUrl

  try {
    const repoRoot = await resolveRepoRoot(fixture.repoPath)
    process.env.ICODE_CONFIG_PATH = path.join(path.dirname(fixture.repoPath), 'remote-merge-config.json')
    setRepoPolicy(repoRoot, {
      remoteMerge: {
        enabled: true,
        projectUrl: ''
      }
    })
    setPlatformConfig('remoteMerge', {
      provider: 'gitlab',
      apiKey: 'rm_test_key'
    })
    GitService.prototype.getRemoteUrl = async () => 'git@gitlab.example.com:group/project.git'

    const fetchCalls = []
    global.fetch = async (url, requestOptions) => {
      fetchCalls.push({
        url,
        method: requestOptions.method,
        body: requestOptions.body ? JSON.parse(requestOptions.body) : null
      })

      if (fetchCalls.length === 1) {
        return {
          ok: true,
          status: 201,
          async text() {
            return JSON.stringify({
              web_url: 'https://gitlab.example.com/group/project/-/merge_requests/1',
              iid: 1,
              sha: 'abc123'
            })
          }
        }
      }

      if (fetchCalls.length === 2) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              state: 'opened',
              detailed_merge_status: 'mergeable'
            })
          }
        }
      }

      if (fetchCalls.length === 3) {
        return {
          ok: true,
          status: 201,
          async text() {
            return JSON.stringify({
              approved: true
            })
          }
        }
      }

      if (fetchCalls.length === 5) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              state: 'opened',
              merge_when_pipeline_succeeds: true,
              detailed_merge_status: 'ci_still_running'
            })
          }
        }
      }

      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            merge_when_pipeline_succeeds: true
          })
        }
      }
    }

    const result = await runPushWorkflow({
      cwd: fixture.repoPath,
      targetBranches: ['test'],
      yes: true,
      repoMode: 'auto',
      remoteMerge: true
    })

    assert.deepEqual(result.summary, [
      { branch: 'source', status: 'pushed' },
      {
        branch: 'test',
        status: 'remote-merged-and-pushed',
        mergeRequestUrl: 'https://gitlab.example.com/group/project/-/merge_requests/1',
        mergeRequestId: '1'
      }
    ])

    assert.deepEqual(fetchCalls, [
      {
        url: 'https://gitlab.example.com/api/v4/projects/group%2Fproject/merge_requests',
        method: 'POST',
        body: {
          source_branch: 'source',
          target_branch: 'test',
          title: 'feat: source branch commit',
          description: 'feat: source branch commit'
        }
      },
      {
        url: 'https://gitlab.example.com/api/v4/projects/group%2Fproject/merge_requests/1?with_merge_status_recheck=true',
        method: 'GET',
        body: null
      },
      {
        url: 'https://gitlab.example.com/api/v4/projects/group%2Fproject/merge_requests/1/approve',
        method: 'POST',
        body: {
          sha: 'abc123'
        }
      },
      {
        url: 'https://gitlab.example.com/api/v4/projects/group%2Fproject/merge_requests/1/merge',
        method: 'PUT',
        body: {
          auto_merge: true,
          sha: 'abc123'
        }
      },
      {
        url: 'https://gitlab.example.com/api/v4/projects/group%2Fproject/merge_requests/1?with_merge_status_recheck=true',
        method: 'GET',
        body: null
      }
    ])

    const policy = getRepoPolicy(repoRoot)
    assert.equal(policy.remoteMerge.projectUrl, '')
  } finally {
    GitService.prototype.getRemoteUrl = originalGetRemoteUrl
    global.fetch = originalFetch
    if (originalConfigPath == null) {
      delete process.env.ICODE_CONFIG_PATH
    } else {
      process.env.ICODE_CONFIG_PATH = originalConfigPath
    }
  }
})

test('push-workflow remote merge auto-detects project url from origin without storing repo config', async () => {
  const fixture = await createRemoteMergeFixture()
  const originalFetch = global.fetch
  const originalConfigPath = process.env.ICODE_CONFIG_PATH
  const originalGetRemoteUrl = GitService.prototype.getRemoteUrl

  try {
    const repoRoot = await resolveRepoRoot(fixture.repoPath)
    process.env.ICODE_CONFIG_PATH = path.join(path.dirname(fixture.repoPath), 'remote-merge-config.json')
    setRepoPolicy(repoRoot, {
      remoteMerge: {
        enabled: true,
        projectUrl: ''
      }
    })
    setPlatformConfig('remoteMerge', {
      provider: 'gitlab',
      apiKey: 'rm_test_key'
    })

    GitService.prototype.getRemoteUrl = async () => 'git@gitlab.example.com:group/project.git'

    const fetchCalls = []
    global.fetch = async (url, requestOptions) => {
      fetchCalls.push(url)

      if (fetchCalls.length === 1) {
        return {
          ok: true,
          status: 201,
          async text() {
            return JSON.stringify({
              web_url: 'https://gitlab.example.com/group/project/-/merge_requests/2',
              iid: 2
            })
          }
        }
      }

      if (fetchCalls.length === 2) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              state: 'opened',
              detailed_merge_status: 'mergeable'
            })
          }
        }
      }

      if (fetchCalls.length === 3) {
        return {
          ok: true,
          status: 201,
          async text() {
            return JSON.stringify({
              approved: true
            })
          }
        }
      }

      if (fetchCalls.length === 5) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              state: 'opened',
              merge_when_pipeline_succeeds: true,
              detailed_merge_status: 'ci_still_running'
            })
          }
        }
      }

      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            merge_when_pipeline_succeeds: true
          })
        }
      }
    }

    const result = await runPushWorkflow({
      cwd: fixture.repoPath,
      targetBranches: ['test'],
      yes: true,
      repoMode: 'auto',
      remoteMerge: true
    })

    assert.deepEqual(result.summary, [
      { branch: 'source', status: 'pushed' },
      {
        branch: 'test',
        status: 'remote-merged-and-pushed',
        mergeRequestUrl: 'https://gitlab.example.com/group/project/-/merge_requests/2',
        mergeRequestId: '2'
      }
    ])

    const policy = getRepoPolicy(repoRoot)
    assert.equal(policy.remoteMerge.projectUrl, '')
    assert.deepEqual(fetchCalls, [
      'https://gitlab.example.com/api/v4/projects/group%2Fproject/merge_requests',
      'https://gitlab.example.com/api/v4/projects/group%2Fproject/merge_requests/2?with_merge_status_recheck=true',
      'https://gitlab.example.com/api/v4/projects/group%2Fproject/merge_requests/2/approve',
      'https://gitlab.example.com/api/v4/projects/group%2Fproject/merge_requests/2/merge',
      'https://gitlab.example.com/api/v4/projects/group%2Fproject/merge_requests/2?with_merge_status_recheck=true'
    ])
  } finally {
    GitService.prototype.getRemoteUrl = originalGetRemoteUrl
    global.fetch = originalFetch
    if (originalConfigPath == null) {
      delete process.env.ICODE_CONFIG_PATH
    } else {
      process.env.ICODE_CONFIG_PATH = originalConfigPath
    }
  }
})

test('push-workflow remote merge succeeds when api returns ok', async () => {
  const fixture = await createRemoteMergeFixture()
  const originalFetch = global.fetch
  const originalConfigPath = process.env.ICODE_CONFIG_PATH
  const originalGetRemoteUrl = GitService.prototype.getRemoteUrl

  try {
    const repoRoot = await resolveRepoRoot(fixture.repoPath)
    process.env.ICODE_CONFIG_PATH = path.join(path.dirname(fixture.repoPath), 'remote-merge-config.json')
    setRepoPolicy(repoRoot, {
      remoteMerge: {
        enabled: true,
        projectUrl: 'https://gitlab.example.com/group/project'
      }
    })
    setPlatformConfig('remoteMerge', {
      provider: 'gitlab',
      apiKey: 'rm_test_key'
    })
    GitService.prototype.getRemoteUrl = async () => 'git@gitlab.example.com:group/project.git'

    let callIndex = 0
    global.fetch = async () => {
      callIndex += 1
      if (callIndex === 1) {
        return {
          ok: true,
          status: 201,
          async text() {
            return JSON.stringify({
              web_url: 'https://gitlab.example.com/group/project/-/merge_requests/1',
              iid: 1,
              sha: 'abc123'
            })
          }
        }
      }

      if (callIndex === 2) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              state: 'opened',
              detailed_merge_status: 'mergeable'
            })
          }
        }
      }

      if (callIndex === 3) {
        return {
          ok: true,
          status: 201,
          async text() {
            return JSON.stringify({
              approved: true
            })
          }
        }
      }

      if (callIndex === 5) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              state: 'opened',
              merge_when_pipeline_succeeds: true,
              detailed_merge_status: 'ci_still_running'
            })
          }
        }
      }

      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            merge_when_pipeline_succeeds: true
          })
        }
      }
    }

    const result = await runPushWorkflow({
      cwd: fixture.repoPath,
      targetBranches: ['test'],
      yes: true,
      repoMode: 'auto',
      remoteMerge: true
    })

    assert.deepEqual(result.summary, [
      { branch: 'source', status: 'pushed' },
      {
        branch: 'test',
        status: 'remote-merged-and-pushed',
        mergeRequestUrl: 'https://gitlab.example.com/group/project/-/merge_requests/1',
        mergeRequestId: '1'
      }
    ])

    const currentBranch = await gitStdout(fixture.repoPath, ['branch', '--show-current'])
    assert.equal(currentBranch, 'source')
    assert.equal(callIndex, 5)
  } finally {
    GitService.prototype.getRemoteUrl = originalGetRemoteUrl
    global.fetch = originalFetch
    if (originalConfigPath == null) {
      delete process.env.ICODE_CONFIG_PATH
    } else {
      process.env.ICODE_CONFIG_PATH = originalConfigPath
    }
  }
})

test('push-workflow remote merge pauses when approval endpoint rejects request', async () => {
  const fixture = await createRemoteMergeFixture()
  const originalFetch = global.fetch
  const originalConfigPath = process.env.ICODE_CONFIG_PATH
  const originalGetRemoteUrl = GitService.prototype.getRemoteUrl

  try {
    const repoRoot = await resolveRepoRoot(fixture.repoPath)
    process.env.ICODE_CONFIG_PATH = path.join(path.dirname(fixture.repoPath), 'remote-merge-config.json')
    setRepoPolicy(repoRoot, {
      remoteMerge: {
        enabled: true,
        projectUrl: 'https://gitlab.example.com/group/project'
      }
    })
    setPlatformConfig('remoteMerge', {
      provider: 'gitlab',
      apiKey: 'rm_test_key'
    })
    GitService.prototype.getRemoteUrl = async () => 'git@gitlab.example.com:group/project.git'

    let callIndex = 0
    global.fetch = async () => {
      callIndex += 1
      if (callIndex === 1) {
        return {
          ok: true,
          status: 201,
          async text() {
            return JSON.stringify({
              web_url: 'https://gitlab.example.com/group/project/-/merge_requests/3',
              iid: 3,
              sha: 'abc123'
            })
          }
        }
      }

      if (callIndex === 2) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              state: 'opened',
              detailed_merge_status: 'mergeable'
            })
          }
        }
      }

      return {
        ok: false,
        status: 401,
        async text() {
          return JSON.stringify({
            message: 'Not allowed to approve this merge request'
          })
        }
      }
    }

    await assert.rejects(
      () => runPushWorkflow({
        cwd: fixture.repoPath,
        targetBranches: ['test'],
        yes: true,
        repoMode: 'auto',
        remoteMerge: true
      }),
      (error) => {
        assert.equal(error.code, 'PUSH_REMOTE_MERGE_PAUSED')
        assert.match(error.message, /远程合并失败\(approve\): Not allowed to approve this merge request/)
        return true
      }
    )

    assert.equal(callIndex, 3)
  } finally {
    GitService.prototype.getRemoteUrl = originalGetRemoteUrl
    global.fetch = originalFetch
    if (originalConfigPath == null) {
      delete process.env.ICODE_CONFIG_PATH
    } else {
      process.env.ICODE_CONFIG_PATH = originalConfigPath
    }
  }
})

test('push-workflow remote merge runs branches concurrently and marks conflicted branch', async () => {
  const fixture = await createRemoteMergeFixture()
  const originalFetch = global.fetch
  const originalConfigPath = process.env.ICODE_CONFIG_PATH
  const originalGetRemoteUrl = GitService.prototype.getRemoteUrl

  try {
    await createRemoteTargetBranch(fixture.repoPath, 'release', 'release.txt')
    const repoRoot = await resolveRepoRoot(fixture.repoPath)
    process.env.ICODE_CONFIG_PATH = path.join(path.dirname(fixture.repoPath), 'remote-merge-config.json')
    setRepoPolicy(repoRoot, {
      remoteMerge: {
        enabled: true,
        projectUrl: 'https://gitlab.example.com/group/project'
      }
    })
    setPlatformConfig('remoteMerge', {
      provider: 'gitlab',
      apiKey: 'rm_test_key'
    })
    GitService.prototype.getRemoteUrl = async () => 'git@gitlab.example.com:group/project.git'

    const stateByMrId = new Map([
      ['1', { targetBranch: 'test', phase: 0 }],
      ['2', { targetBranch: 'release', phase: 0 }]
    ])
    let createdCount = 0

    global.fetch = async (url, requestOptions = {}) => {
      const body = requestOptions.body ? JSON.parse(requestOptions.body) : null

      if (url.endsWith('/merge_requests') && requestOptions.method === 'POST') {
        createdCount += 1
        const mergeRequestId = body.target_branch === 'test' ? '1' : '2'
        return {
          ok: true,
          status: 201,
          async text() {
            return JSON.stringify({
              iid: Number(mergeRequestId),
              sha: `${mergeRequestId}abc`,
              web_url: `https://gitlab.example.com/group/project/-/merge_requests/${mergeRequestId}`
            })
          }
        }
      }

      if (url.includes('/approve') && requestOptions.method === 'POST') {
        return {
          ok: true,
          status: 201,
          async text() {
            return JSON.stringify({
              approved: true
            })
          }
        }
      }

      if (url.includes('/merge') && requestOptions.method === 'PUT') {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              merge_when_pipeline_succeeds: true
            })
          }
        }
      }

      const mergeRequestMatch = url.match(/merge_requests\/(\d+)\?with_merge_status_recheck=true$/)
      assert.ok(mergeRequestMatch)
      const mergeRequestId = mergeRequestMatch[1]
      const state = stateByMrId.get(mergeRequestId)
      assert.ok(state)
      state.phase += 1

      if (state.targetBranch === 'test') {
        if (state.phase === 1) {
          return {
            ok: true,
            status: 200,
            async text() {
              return JSON.stringify({
                state: 'opened',
                detailed_merge_status: 'checking'
              })
            }
          }
        }

        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              state: 'opened',
              has_conflicts: true,
              detailed_merge_status: 'conflict',
              web_url: 'https://gitlab.example.com/group/project/-/merge_requests/1'
            })
          }
        }
      }

      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            state: 'opened',
            merge_when_pipeline_succeeds: true,
            detailed_merge_status: 'ci_still_running',
            web_url: 'https://gitlab.example.com/group/project/-/merge_requests/2'
          })
        }
      }
    }

    await assert.rejects(
      () => runPushWorkflow({
        cwd: fixture.repoPath,
        targetBranches: ['test', 'release'],
        yes: true,
        repoMode: 'auto',
        remoteMerge: true
      }),
      (error) => {
        assert.equal(error.code, 'PUSH_REMOTE_MERGE_PAUSED')
        assert.match(error.message, /test: 远程合并冲突/)
        assert.ok(Array.isArray(error.meta.summary))
        assert.deepEqual(error.meta.summary, [
          { branch: 'source', status: 'pushed' },
          { branch: 'test', status: 'paused', reason: '远程合并冲突(inspect): conflict [step=inspect]' },
          {
            branch: 'release',
            status: 'remote-merged-and-pushed',
            mergeRequestUrl: 'https://gitlab.example.com/group/project/-/merge_requests/2',
            mergeRequestId: '2'
          }
        ])
        return true
      }
    )

    assert.equal(createdCount, 2)
  } finally {
    GitService.prototype.getRemoteUrl = originalGetRemoteUrl
    global.fetch = originalFetch
    if (originalConfigPath == null) {
      delete process.env.ICODE_CONFIG_PATH
    } else {
      process.env.ICODE_CONFIG_PATH = originalConfigPath
    }
  }
})
