import { IcodeError } from './errors.js'
import { requestGitLabRemoteMerge, resolveGitLabProjectUrlFromRemote } from './remote-merge/providers/gitlab.js'

const REMOTE_MERGE_PROVIDERS = {
  gitlab: {
    requestRemoteMerge: requestGitLabRemoteMerge,
    resolveProjectUrlFromRemote: resolveGitLabProjectUrlFromRemote
  }
}

// 按 provider 读取远程合并实现，缺失或不支持时统一抛出明确错误。
function getRemoteMergeProvider(provider) {
  const normalizedProvider = String(provider || '').trim()
  if (!normalizedProvider) {
    throw new IcodeError('远程合并缺少 provider', {
      code: 'REMOTE_MERGE_PROVIDER_EMPTY',
      exitCode: 2
    })
  }

  const handler = REMOTE_MERGE_PROVIDERS[normalizedProvider]
  if (!handler) {
    throw new IcodeError(`当前仅支持: ${Object.keys(REMOTE_MERGE_PROVIDERS).join(', ')}，收到 provider=${normalizedProvider}`, {
      code: 'REMOTE_MERGE_PROVIDER_UNSUPPORTED',
      exitCode: 2
    })
  }

  return handler
}

// 统一根据 provider 从 remote URL 解析项目地址，避免工作流层感知平台细节。
export function resolveRemoteMergeProjectUrl(options = {}) {
  const handler = getRemoteMergeProvider(options.provider)
  return handler.resolveProjectUrlFromRemote(options.remoteUrl || '')
}

// 统一按 provider 调度远程合并请求，后续新增平台只需补 provider 实现。
export async function requestRemoteMerge(options = {}) {
  const handler = getRemoteMergeProvider(options.provider)
  return handler.requestRemoteMerge(options)
}
