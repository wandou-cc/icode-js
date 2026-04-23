import { IcodeError } from '../../errors.js'
import { normalizeRemoteMergeReason, parseRemoteMergePayload } from '../shared.js'

const GITLAB_MERGE_STATUS_POLL_INTERVAL_MS = 1000
const GITLAB_PENDING_MERGE_STATUSES = new Set([
  'unchecked',
  'checking',
  'preparing',
  'approvals_syncing'
])
const GITLAB_CONFLICT_MERGE_STATUSES = new Set([
  'cannot_be_merged',
  'conflict'
])
const GITLAB_ACCEPTED_MERGE_STATUSES = new Set([
  'mergeable',
  'ci_still_running',
  'ci_must_pass',
  'merge_time'
])

// 根据 Git remote URL 生成标准 GitLab 项目 URL，无法识别时返回空串。
export function resolveGitLabProjectUrlFromRemote(remoteUrl = '') {
  const raw = String(remoteUrl || '').trim()
  if (!raw) {
    return ''
  }

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw.replace(/\.git$/i, '').replace(/\/+$/g, '')
  }

  if (raw.startsWith('ssh://')) {
    try {
      const parsed = new URL(raw)
      const repoPath = parsed.pathname.replace(/^\/+/, '').replace(/\.git$/i, '')
      if (!parsed.hostname || !repoPath) {
        return ''
      }
      return `https://${parsed.hostname}/${repoPath}`
    } catch {
      return ''
    }
  }

  const sshMatch = raw.match(/^git@([^:]+):(.+)$/i)
  if (!sshMatch) {
    return ''
  }

  const host = sshMatch[1]
  const repoPath = sshMatch[2].replace(/\.git$/i, '')
  return `https://${host}/${repoPath}`
}

// 解析 GitLab 项目 URL，按官方 REST 规范生成 host 级 API 地址与完整项目 path。
function parseGitLabProject(projectUrl = '') {
  const normalizedProjectUrl = String(projectUrl || '').trim().replace(/\/+$/g, '')
  if (!normalizedProjectUrl) {
    throw new IcodeError('远程合并缺少 GitLab 项目 URL', {
      code: 'REMOTE_MERGE_PROJECT_URL_EMPTY',
      exitCode: 2
    })
  }

  let parsedUrl
  try {
    parsedUrl = new URL(normalizedProjectUrl)
  } catch (error) {
    throw new IcodeError(`GitLab 项目 URL 无效: ${normalizedProjectUrl}`, {
      code: 'REMOTE_MERGE_PROJECT_URL_INVALID',
      exitCode: 2,
      cause: error
    })
  }

  const projectPath = parsedUrl.pathname.replace(/^\/+/, '').replace(/\/+$/g, '')
  if (!projectPath) {
    throw new IcodeError(`GitLab 项目 URL 缺少仓库路径: ${normalizedProjectUrl}`, {
      code: 'REMOTE_MERGE_PROJECT_PATH_EMPTY',
      exitCode: 2
    })
  }

  return {
    baseUrl: `${parsedUrl.protocol}//${parsedUrl.host}`,
    projectId: encodeURIComponent(projectPath)
  }
}

// 生成 GitLab 创建 MR 所需标题，确保最小必填字段始终完整。
function buildGitLabMergeRequestTitle(options = {}) {
  const title = String(options.mergeRequestTitle || '').trim()
  if (!title) {
    throw new IcodeError('GitLab 远程合并缺少 mergeRequestTitle', {
      code: 'REMOTE_MERGE_TITLE_REQUIRED',
      exitCode: 2
    })
  }

  return title
}

// 生成 GitLab 创建 MR 所需正文，正文完全使用待合并 commit 内容。
function buildGitLabMergeRequestDescription(options = {}) {
  const description = String(options.mergeRequestDescription || '').trim()
  if (!description) {
    throw new IcodeError('GitLab 远程合并缺少 mergeRequestDescription', {
      code: 'REMOTE_MERGE_DESCRIPTION_REQUIRED',
      exitCode: 2
    })
  }

  return description
}

// 等待指定毫秒，供轮询 GitLab 异步合并状态时复用。
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

// 执行一次 GitLab JSON 请求，并统一返回响应对象、原始文本和解析后的负载。
async function performGitLabJsonRequest(endpoint, requestOptions, errorMessage) {
  let response

  try {
    response = await fetch(endpoint, requestOptions)
  } catch (error) {
    throw new IcodeError(`${errorMessage}: ${error?.message || '未知网络错误'}`, {
      code: 'REMOTE_MERGE_FETCH_ERROR',
      exitCode: 2,
      cause: error
    })
  }

  const rawText = await response.text()
  const payload = parseRemoteMergePayload(rawText)

  return {
    response,
    rawText,
    payload
  }
}

// 把 GitLab HTTP 错误响应归一化成统一的远程合并失败结果。
function buildGitLabFailedResult(response, rawText, payload, extra = {}) {
  return {
    ok: false,
    conflict: response.status === 409,
    status: response.status,
    reason: normalizeRemoteMergeReason(payload, `HTTP ${response.status}${rawText ? `: ${rawText.trim()}` : ''}`),
    payload,
    ...extra
  }
}

// 读取 GitLab MR 当前状态，触发一次 merge status 重算后返回详情。
async function fetchGitLabMergeRequest(project, mergeRequestId, apiKey) {
  const endpoint = new URL(`${project.baseUrl}/api/v4/projects/${project.projectId}/merge_requests/${mergeRequestId}`)
  endpoint.searchParams.set('with_merge_status_recheck', 'true')

  const { response, rawText, payload } = await performGitLabJsonRequest(
    endpoint.toString(),
    {
      method: 'GET',
      headers: {
        'PRIVATE-TOKEN': apiKey
      }
    },
    'GitLab 查询合并请求状态失败'
  )

  return {
    response,
    rawText,
    payload
  }
}

// 将 GitLab MR 状态转换成统一结果，保证上层能明确识别冲突分支。
function buildGitLabMergeStatusResult(payload, mergeRequestId, mergeRequestUrl) {
  const detailedMergeStatus = typeof payload?.detailed_merge_status === 'string'
    ? payload.detailed_merge_status.trim()
    : ''
  const mergeStatus = typeof payload?.merge_status === 'string'
    ? payload.merge_status.trim()
    : ''
  const normalizedStatus = detailedMergeStatus || mergeStatus
  const mergeError = typeof payload?.merge_error === 'string' ? payload.merge_error.trim() : ''
  const state = typeof payload?.state === 'string' ? payload.state.trim() : ''
  const reason = normalizeRemoteMergeReason(
    payload,
    mergeError || normalizedStatus || 'GitLab 未返回明确合并状态'
  )

  if (payload?.has_conflicts === true || GITLAB_CONFLICT_MERGE_STATUSES.has(normalizedStatus)) {
    return {
      ok: false,
      conflict: true,
      status: 409,
      reason,
      step: 'inspect',
      mergeRequestId,
      mergeRequestUrl,
      payload
    }
  }

  if (state === 'merged') {
    return {
      ok: true,
      conflict: false,
      status: 200,
      reason: '远程合并已完成',
      mergeRequestId,
      mergeRequestUrl,
      payload
    }
  }

  if (payload?.merge_when_pipeline_succeeds === true || payload?.auto_merge_enabled === true) {
    return {
      ok: true,
      conflict: false,
      status: 202,
      reason: '远程合并已提交，等待 GitLab 完成异步合并检查',
      mergeRequestId,
      mergeRequestUrl,
      payload
    }
  }

  if (GITLAB_ACCEPTED_MERGE_STATUSES.has(normalizedStatus)) {
    return {
      ok: true,
      conflict: false,
      status: 200,
      reason: '远程合并校验通过',
      mergeRequestId,
      mergeRequestUrl,
      payload
    }
  }

  if (GITLAB_PENDING_MERGE_STATUSES.has(normalizedStatus)) {
    return null
  }

  return {
    ok: false,
    conflict: false,
    status: 409,
    reason,
    step: 'inspect',
    mergeRequestId,
    mergeRequestUrl,
    payload
  }
}

// 将 GitLab MR 状态转换成“是否可以开始执行 merge”的结果。
function buildGitLabMergeReadinessResult(payload, mergeRequestId, mergeRequestUrl) {
  const detailedMergeStatus = typeof payload?.detailed_merge_status === 'string'
    ? payload.detailed_merge_status.trim()
    : ''
  const mergeStatus = typeof payload?.merge_status === 'string'
    ? payload.merge_status.trim()
    : ''
  const normalizedStatus = detailedMergeStatus || mergeStatus
  const mergeError = typeof payload?.merge_error === 'string' ? payload.merge_error.trim() : ''
  const state = typeof payload?.state === 'string' ? payload.state.trim() : ''
  const reason = normalizeRemoteMergeReason(
    payload,
    mergeError || normalizedStatus || 'GitLab 未返回明确合并状态'
  )

  if (payload?.has_conflicts === true || GITLAB_CONFLICT_MERGE_STATUSES.has(normalizedStatus)) {
    return {
      ok: false,
      conflict: true,
      status: 409,
      reason,
      step: 'inspect',
      mergeRequestId,
      mergeRequestUrl,
      payload
    }
  }

  if (state === 'merged') {
    return {
      ok: true,
      conflict: false,
      status: 200,
      reason: '远程合并已完成',
      mergeRequestId,
      mergeRequestUrl,
      payload
    }
  }

  if (GITLAB_ACCEPTED_MERGE_STATUSES.has(normalizedStatus)) {
    return {
      ok: true,
      conflict: false,
      status: 200,
      reason: 'GitLab 已完成合并前检查',
      mergeRequestId,
      mergeRequestUrl,
      payload
    }
  }

  if (GITLAB_PENDING_MERGE_STATUSES.has(normalizedStatus)) {
    return null
  }

  return {
    ok: false,
    conflict: false,
    status: 409,
    reason,
    step: 'inspect',
    mergeRequestId,
    mergeRequestUrl,
    payload
  }
}

// 轮询 GitLab MR，直到“是否允许 merge”检查完成。
async function waitForGitLabMergeReadiness(project, mergeRequestId, mergeRequestUrl, apiKey) {
  while (true) {
    const mergeRequest = await fetchGitLabMergeRequest(project, mergeRequestId, apiKey)
    if (!mergeRequest.response.ok) {
      return buildGitLabFailedResult(mergeRequest.response, mergeRequest.rawText, mergeRequest.payload, {
        step: 'inspect',
        mergeRequestId,
        mergeRequestUrl,
        payload: {
          create: null,
          approve: null,
          merge: null,
          inspect: mergeRequest.payload
        }
      })
    }

    const result = buildGitLabMergeReadinessResult(mergeRequest.payload, mergeRequestId, mergeRequestUrl)
    if (result) {
      return result
    }

    await delay(GITLAB_MERGE_STATUS_POLL_INTERVAL_MS)
  }
}

// 轮询 GitLab MR，直到异步冲突检查完成并得到可归档的最终状态。
async function waitForGitLabMergeOutcome(project, mergeRequestId, mergeRequestUrl, apiKey) {
  while (true) {
    const mergeRequest = await fetchGitLabMergeRequest(project, mergeRequestId, apiKey)
    if (!mergeRequest.response.ok) {
      return buildGitLabFailedResult(mergeRequest.response, mergeRequest.rawText, mergeRequest.payload, {
        step: 'inspect',
        mergeRequestId,
        mergeRequestUrl,
        payload: {
          create: null,
          approve: null,
          merge: null,
          inspect: mergeRequest.payload
        }
      })
    }

    const result = buildGitLabMergeStatusResult(mergeRequest.payload, mergeRequestId, mergeRequestUrl)
    if (result) {
      return result
    }

    await delay(GITLAB_MERGE_STATUS_POLL_INTERVAL_MS)
  }
}

// 根据创建 MR 的结果先执行审批，再提交自动合并，确保完整走完 GitLab 审批合并链路。
async function processGitLabMergeRequest(project, createPayload, apiKey) {
  const mergeRequestId = createPayload?.iid ? String(createPayload.iid) : ''
  const mergeRequestUrl = typeof createPayload?.web_url === 'string' ? createPayload.web_url : ''

  if (!mergeRequestId) {
    return {
      ok: false,
      conflict: false,
      status: 200,
      reason: 'GitLab 创建合并请求成功，但响应缺少 iid，无法继续自动合并。',
      step: 'merge',
      mergeRequestId,
      mergeRequestUrl,
      payload: {
        create: createPayload,
        merge: null
      }
    }
  }

  const sourceSha = typeof createPayload?.sha === 'string' ? createPayload.sha.trim() : ''
  const readinessResult = await waitForGitLabMergeReadiness(project, mergeRequestId, mergeRequestUrl, apiKey)
  if (!readinessResult.ok) {
    return {
      ...readinessResult,
      payload: {
        create: createPayload,
        approve: null,
        merge: null,
        inspect: readinessResult.payload
      }
    }
  }

  const approveRequestBody = {}
  if (sourceSha) {
    approveRequestBody.sha = sourceSha
  }

  const approveEndpoint = `${project.baseUrl}/api/v4/projects/${project.projectId}/merge_requests/${mergeRequestId}/approve`
  const approveResult = await performGitLabJsonRequest(
    approveEndpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'PRIVATE-TOKEN': apiKey
      },
      body: JSON.stringify(approveRequestBody)
    },
    'GitLab 合并审批请求失败'
  )

  if (!approveResult.response.ok) {
    return buildGitLabFailedResult(approveResult.response, approveResult.rawText, approveResult.payload, {
      step: 'approve',
      mergeRequestId,
      mergeRequestUrl,
      payload: {
        create: createPayload,
        approve: approveResult.payload,
        merge: null
      }
    })
  }

  const mergeRequestBody = {
    auto_merge: true
  }
  if (sourceSha) {
    mergeRequestBody.sha = sourceSha
  }

  const mergeEndpoint = `${project.baseUrl}/api/v4/projects/${project.projectId}/merge_requests/${mergeRequestId}/merge`
  const mergeResult = await performGitLabJsonRequest(
    mergeEndpoint,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'PRIVATE-TOKEN': apiKey
      },
      body: JSON.stringify(mergeRequestBody)
    },
    'GitLab 自动合并请求失败'
  )

  if (!mergeResult.response.ok) {
    return buildGitLabFailedResult(mergeResult.response, mergeResult.rawText, mergeResult.payload, {
      step: 'merge',
      mergeRequestId,
      mergeRequestUrl,
      payload: {
        create: createPayload,
        approve: approveResult.payload,
        merge: mergeResult.payload
      }
    })
  }

  const finalResult = await waitForGitLabMergeOutcome(project, mergeRequestId, mergeRequestUrl, apiKey)
  return {
    ...finalResult,
    payload: {
      create: createPayload,
      approve: approveResult.payload,
      merge: mergeResult.payload,
      inspect: finalResult.payload
    }
  }
}

// 按 GitLab 固定 REST API 发起 MR 创建请求，并返回统一结果结构。
export async function requestGitLabRemoteMerge(options = {}) {
  const apiKey = String(options.apiKey || '').trim()
  if (!apiKey) {
    throw new IcodeError('远程合并缺少 apiKey', {
      code: 'REMOTE_MERGE_API_KEY_EMPTY',
      exitCode: 2
    })
  }

  const project = parseGitLabProject(options.projectUrl)
  const endpoint = `${project.baseUrl}/api/v4/projects/${project.projectId}/merge_requests`
  const { response, rawText, payload } = await performGitLabJsonRequest(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'PRIVATE-TOKEN': apiKey
      },
      body: JSON.stringify({
        source_branch: options.sourceBranch,
        target_branch: options.targetBranch,
        title: buildGitLabMergeRequestTitle(options),
        description: buildGitLabMergeRequestDescription(options)
      })
    },
    'GitLab 创建合并请求失败'
  )

  if (!response.ok) {
    return buildGitLabFailedResult(response, rawText, payload, {
      step: 'create'
    })
  }

  return processGitLabMergeRequest(project, payload, apiKey)
}
