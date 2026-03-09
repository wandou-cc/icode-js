import { askAi } from '../core/ai-client.js'
import { IcodeError } from '../core/errors.js'
import { resolveGitContext } from '../core/git-context.js'
import { GitService } from '../core/git-service.js'

function truncate(value, limit) {
  if (value.length <= limit) {
    return value
  }
  return `${value.slice(0, limit)}\n\n...<truncated>`
}

export async function runAiCodeReviewWorkflow(options) {
  const context = await resolveGitContext({
    cwd: options.cwd,
    repoMode: options.repoMode
  })
  const git = new GitService(context)

  const defaultBase = options.baseRef || `origin/${context.defaultBranch}`
  const headRef = options.headRef || 'HEAD'

  const { rangeSpec, diff } = await git.diffBetween(defaultBase, headRef, { style: 'three-dot' })

  if (!diff.trim()) {
    throw new IcodeError(`范围 ${rangeSpec} 内没有代码差异。`, {
      code: 'AI_CODEREVIEW_EMPTY_DIFF',
      exitCode: 2
    })
  }

  const stat = await git.diffStat(rangeSpec)
  const nameStatus = await git.diffNameStatus(rangeSpec)

  const review = await askAi(
    {
      systemPrompt: '你是严格的软件代码审查工程师，请优先关注 bug、安全风险、行为回归、缺失测试。输出中文 Markdown。',
      userPrompt: `请按如下结构输出：\n1. Findings（按严重度从高到低）\n2. Open Questions\n3. Summary\n\nFocus: ${options.focus || 'general'}\nRange: ${rangeSpec}\n\nDiff Stat:\n${truncate(stat, 3000)}\n\nName Status:\n${truncate(nameStatus, 3000)}\n\nUnified Diff:\n${truncate(diff, 18000)}`
    },
    {
      profile: options.profile
    }
  )

  return {
    rangeSpec,
    review
  }
}
