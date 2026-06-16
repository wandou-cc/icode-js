import assert from 'node:assert/strict'
import test from 'node:test'
import { requestRemoteMerge, resolveRemoteMergeProjectUrl } from '../src/core/remote-merge/client.js'
import { logger } from '../src/core/tools/logger.js'

test('remote-merge-client dispatches project url resolution by provider', () => {
  assert.equal(
    resolveRemoteMergeProjectUrl({
      provider: 'gitlab',
      remoteUrl: 'git@gitlab.example.com:group/project.git'
    }),
    'https://gitlab.example.com/group/project'
  )
})

test('remote-merge-client rejects unsupported provider when resolving project url', () => {
  assert.throws(
    () => resolveRemoteMergeProjectUrl({
      provider: 'github',
      remoteUrl: 'git@github.com:owner/repo.git'
    }),
    (error) => {
      assert.equal(error.code, 'REMOTE_MERGE_PROVIDER_UNSUPPORTED')
      return true
    }
  )
})

test('remote-merge-client dispatches request to gitlab provider', async () => {
  const originalFetch = global.fetch

  try {
    const calls = []
    global.fetch = async (url, requestOptions) => {
      calls.push({
        url,
        method: requestOptions.method,
        body: requestOptions.body ? JSON.parse(requestOptions.body) : null
      })

      if (calls.length === 1) {
        return {
          ok: true,
          status: 201,
          async text() {
            return JSON.stringify({
              iid: 8,
              sha: 'abc123',
              web_url: 'https://gitlab.example.com/group/project/-/merge_requests/8'
            })
          }
        }
      }

      if (calls.length === 2) {
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

      if (calls.length === 3) {
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

    const result = await requestRemoteMerge({
      provider: 'gitlab',
      apiKey: 'rm_test_key',
      projectUrl: 'https://gitlab.example.com/group/project',
      sourceBranch: 'source',
      targetBranch: 'target',
      mergeRequestTitle: 'feat(remote): push merge request',
      mergeRequestDescription: 'feat(remote): push merge request\n\nbody line'
    })

    assert.deepEqual(calls, [
      {
        url: 'https://gitlab.example.com/api/v4/projects/group%2Fproject/merge_requests',
        method: 'POST',
        body: {
          source_branch: 'source',
          target_branch: 'target',
          title: 'feat(remote): push merge request',
          description: 'feat(remote): push merge request\n\nbody line'
        }
      },
      {
        url: 'https://gitlab.example.com/api/v4/projects/group%2Fproject/merge_requests/8?with_merge_status_recheck=true',
        method: 'GET',
        body: null
      },
      {
        url: 'https://gitlab.example.com/api/v4/projects/group%2Fproject/merge_requests/8/merge',
        method: 'PUT',
        body: {
          auto_merge: true,
          sha: 'abc123'
        }
      },
      {
        url: 'https://gitlab.example.com/api/v4/projects/group%2Fproject/merge_requests/8?with_merge_status_recheck=true',
        method: 'GET',
        body: null
      }
    ])

    assert.deepEqual(result, {
      ok: true,
      conflict: false,
      status: 202,
      reason: '远程合并已提交，等待 GitLab 完成异步合并检查',
      mergeRequestId: '8',
      mergeRequestUrl: 'https://gitlab.example.com/group/project/-/merge_requests/8',
      payload: {
        create: {
          iid: 8,
          sha: 'abc123',
          web_url: 'https://gitlab.example.com/group/project/-/merge_requests/8'
        },
        merge: {
          merge_when_pipeline_succeeds: true
        },
        inspect: {
          state: 'opened',
          merge_when_pipeline_succeeds: true,
          detailed_merge_status: 'ci_still_running'
        }
      }
    })
  } finally {
    global.fetch = originalFetch
  }
})

test('remote-merge-client uses host api root and full project path from origin url', async () => {
  const originalFetch = global.fetch

  try {
    const calls = []
    global.fetch = async (url) => {
      calls.push(url)

      if (calls.length === 1) {
        assert.equal(url, 'https://icode.izuche.com/api/v4/projects/web%2Fizu-dataai-ui-client/merge_requests')
        return {
          ok: true,
          status: 201,
          async text() {
            return JSON.stringify({
              iid: 11,
              sha: 'subpath123',
              web_url: 'https://icode.izuche.com/web/izu-dataai-ui-client/-/merge_requests/11'
            })
          }
        }
      }

      if (calls.length === 2) {
        assert.equal(url, 'https://icode.izuche.com/api/v4/projects/web%2Fizu-dataai-ui-client/merge_requests/11?with_merge_status_recheck=true')
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

      if (calls.length === 3) {
        assert.equal(url, 'https://icode.izuche.com/api/v4/projects/web%2Fizu-dataai-ui-client/merge_requests/11/merge')
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

      assert.equal(url, 'https://icode.izuche.com/api/v4/projects/web%2Fizu-dataai-ui-client/merge_requests/11?with_merge_status_recheck=true')
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

    const result = await requestRemoteMerge({
      provider: 'gitlab',
      apiKey: 'rm_test_key',
      projectUrl: 'https://icode.izuche.com/web/izu-dataai-ui-client',
      sourceBranch: 'feature/a',
      targetBranch: 'test',
      mergeRequestTitle: 'feat(web): improve merge',
      mergeRequestDescription: 'feat(web): improve merge'
    })

    assert.equal(result.ok, true)
    assert.equal(result.mergeRequestId, '11')
    assert.equal(result.mergeRequestUrl, 'https://icode.izuche.com/web/izu-dataai-ui-client/-/merge_requests/11')
    assert.equal(calls.length, 4)
  } finally {
    global.fetch = originalFetch
  }
})

test('remote-merge-client times out pending gitlab merge checks', async () => {
  const originalFetch = global.fetch

  try {
    const calls = []
    global.fetch = async (url, requestOptions) => {
      calls.push({
        url,
        method: requestOptions.method
      })

      if (calls.length === 1) {
        return {
          ok: true,
          status: 201,
          async text() {
            return JSON.stringify({
              iid: 21,
              sha: 'pending123',
              web_url: 'https://gitlab.example.com/group/project/-/merge_requests/21'
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
            detailed_merge_status: 'checking'
          })
        }
      }
    }

    const result = await requestRemoteMerge({
      provider: 'gitlab',
      apiKey: 'rm_test_key',
      projectUrl: 'https://gitlab.example.com/group/project',
      sourceBranch: 'source',
      targetBranch: 'target',
      mergeRequestTitle: 'feat(remote): pending merge request',
      mergeRequestDescription: 'feat(remote): pending merge request',
      maxPollAttempts: 2,
      pollIntervalMs: 0
    })

    assert.equal(result.ok, false)
    assert.equal(result.status, 408)
    assert.equal(result.step, 'inspect')
    assert.match(result.reason, /GitLab 合并检查超时/)
    assert.equal(calls.length, 3)
  } finally {
    global.fetch = originalFetch
  }
})

test('remote-merge-client does not print repeated pending gitlab polling logs', async () => {
  const originalFetch = global.fetch
  const originalInfo = logger.info
  const capturedInfoLogs = []

  logger.info = (message) => {
    capturedInfoLogs.push(String(message))
  }

  try {
    const calls = []
    global.fetch = async () => {
      calls.push(true)

      if (calls.length === 1) {
        return {
          ok: true,
          status: 201,
          async text() {
            return JSON.stringify({
              iid: 31,
              sha: 'pending-log-check',
              web_url: 'https://gitlab.example.com/group/project/-/merge_requests/31'
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
            detailed_merge_status: 'checking'
          })
        }
      }
    }

    const result = await requestRemoteMerge({
      provider: 'gitlab',
      apiKey: 'rm_test_key',
      projectUrl: 'https://gitlab.example.com/group/project',
      sourceBranch: 'source',
      targetBranch: 'target',
      mergeRequestTitle: 'feat(remote): pending merge request',
      mergeRequestDescription: 'feat(remote): pending merge request',
      maxPollAttempts: 3,
      pollIntervalMs: 0
    })

    assert.equal(result.status, 408)
    assert.equal(calls.length, 4)
    assert.deepEqual(capturedInfoLogs, [])
  } finally {
    logger.info = originalInfo
    global.fetch = originalFetch
  }
})
