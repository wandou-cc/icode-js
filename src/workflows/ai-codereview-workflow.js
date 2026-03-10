import { askAi } from '../core/ai-client.js'
import { IcodeError } from '../core/errors.js'
import { resolveGitContext } from '../core/git-context.js'
import { GitService } from '../core/git-service.js'

function truncate(value, limit) {
  const text = value || ''
  if (text.length <= limit) {
    return text
  }
  return `${text.slice(0, limit)}\n\n...<truncated>`
}

function joinSections(sections) {
  return sections
    .map((item) => (item || '').trim())
    .filter(Boolean)
    .join('\n\n')
}

export async function runAiCodeReviewWorkflow(options) {
  const context = await resolveGitContext({
    cwd: options.cwd,
    repoMode: options.repoMode
  })
  const git = new GitService(context)

  const defaultBase = options.baseRef || `origin/${context.defaultBranch}`
  const headRef = options.headRef || 'HEAD'

  const rangeResult = await git.diffBetween(defaultBase, headRef, { style: 'three-dot' })

  let rangeSpec = rangeResult.rangeSpec
  let diff = rangeResult.diff
  let stat = ''
  let nameStatus = ''
  let diffSource = 'three-dot-range'

  if (diff.trim()) {
    stat = await git.diffStat(rangeSpec)
    nameStatus = await git.diffNameStatus(rangeSpec)
  } else {
    // 默认回退策略: 当范围 diff 为空时，自动审查“未提交代码（暂存 + 工作区）”。
    const stagedDiff = await git.diffStaged()
    const workingDiff = await git.diffWorkingTree()

    if (!stagedDiff.trim() && !workingDiff.trim()) {
      throw new IcodeError(`范围 ${rangeSpec} 内没有代码差异，且暂存区/工作区也没有改动。`, {
        code: 'AI_CODEREVIEW_EMPTY_DIFF',
        exitCode: 2
      })
    }

    diffSource = 'uncommitted'
    rangeSpec = 'uncommitted(staged+working-tree)'
    diff = joinSections([
      stagedDiff ? `--- STAGED DIFF ---\n${stagedDiff}` : '',
      workingDiff ? `--- WORKING TREE DIFF ---\n${workingDiff}` : ''
    ])
    stat = joinSections([
      stagedDiff ? `--- STAGED STAT ---\n${await git.diffStagedStat()}` : '',
      workingDiff ? `--- WORKING TREE STAT ---\n${await git.diffStat()}` : ''
    ])
    nameStatus = joinSections([
      stagedDiff ? `--- STAGED NAME STATUS ---\n${await git.diffStagedNameStatus()}` : '',
      workingDiff ? `--- WORKING TREE NAME STATUS ---\n${await git.diffNameStatus()}` : ''
    ])
  }

  const review = await askAi(
    {
      systemPrompt: '你是严格的软件代码审查工程师，请优先关注 bug、安全风险、行为回归、缺失测试。输出中文 Markdown。',
      userPrompt: `请按如下结构输出：\n1. Findings（按严重度从高到低）\n2. Open Questions\n3. Summary\n\nFocus: ${options.focus || 'general'}\nRange: ${rangeSpec}\nDiff Source: ${diffSource}\n\nDiff Stat:\n${truncate(stat, 3000)}\n\nName Status:\n${truncate(nameStatus, 3000)}\n\nUnified Diff:\n${truncate(diff, 18000)}`
    },
    {
      profile: options.profile,
      dumpResponse: options.dumpResponse
    }
  )

  if (!review || !review.trim()) {
    throw new IcodeError('AI Code Review 返回为空，请检查 AI profile/model 是否可用后重试。', {
      code: 'AI_CODEREVIEW_EMPTY_RESPONSE',
      exitCode: 2
    })
  }

  return {
    rangeSpec,
    review
  }
}
