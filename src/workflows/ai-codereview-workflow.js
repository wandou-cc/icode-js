import { askAi } from '../core/ai/client.js'
import { buildLimitedDiffPrompt, formatDiffCoverage, summarizeDiffCoverage } from '../core/ai/diff-prompt.js'
import { resolveAiDiffRange } from '../core/ai/diff-range.js'
import { IcodeError } from '../core/errors.js'
import { resolveGitContext } from '../core/git/context.js'
import { GitService } from '../core/git/service.js'

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

// 构建 AI code review prompt 中的 diff 片段，输入完整 diff，输出受限 diff 与覆盖范围。
function buildReviewDiffPrompt(diff) {
  return buildLimitedDiffPrompt(diff, {
    limit: 18000
  })
}

// 执行 AI 代码审查工作流，输入 diff 范围和 AI 选项，输出审查文本与 diff 覆盖范围。
export async function runAiCodeReviewWorkflow(options) {
  const context = await resolveGitContext({
    cwd: options.cwd,
    repoMode: options.repoMode
  })
  const git = new GitService(context)

  const explicitBase = Boolean((options.baseRef || '').trim())
  const explicitHead = Boolean((options.headRef || '').trim())
  const useRangeMode = explicitBase || explicitHead
  const headRef = options.headRef || 'HEAD'

  let rangeSpec = ''
  let diff = ''
  let stat = ''
  let nameStatus = ''
  let diffSource = 'three-dot-range'
  let rangeError = null

  if (useRangeMode) {
    try {
      const rangeResult = await resolveAiDiffRange({
        git,
        context,
        baseRef: options.baseRef,
        headRef,
        explicitHead,
        label: 'Code Review'
      })
      rangeSpec = rangeResult.rangeSpec
      diff = rangeResult.diff
    } catch (error) {
      rangeError = error
    }
  }

  if (diff.trim()) {
    stat = await git.diffStat(rangeSpec)
    nameStatus = await git.diffNameStatus(rangeSpec)
  } else {
    if (rangeError && useRangeMode) {
      throw rangeError
    }

    // 默认回退策略: 当范围 diff 为空时，自动审查“未提交代码（暂存 + 工作区）”。
    const stagedDiff = await git.diffStaged()
    const workingDiff = await git.diffWorkingTree()

    if (rangeError && !stagedDiff.trim() && !workingDiff.trim()) {
      throw rangeError
    }

    if (!stagedDiff.trim() && !workingDiff.trim()) {
      if (!useRangeMode) {
        throw new IcodeError('暂存区/工作区没有代码改动。若要评审分支差异，请显式传入 --base 或 --head。', {
          code: 'AI_CODEREVIEW_EMPTY_DIFF',
          exitCode: 2
        })
      }

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

  const limitedDiff = buildReviewDiffPrompt(diff)

  const review = await askAi(
    {
      systemPrompt: '你是严格的软件代码审查工程师，请优先关注 bug、安全风险、行为回归、缺失测试。输出中文 Markdown。',
      userPrompt: `请按如下结构输出：\n1. Findings（按严重度从高到低）\n2. Open Questions\n3. Summary\n\nFocus: ${options.focus || 'general'}\nRange: ${rangeSpec}\nDiff Source: ${diffSource}\n\n${formatDiffCoverage(limitedDiff.coverage)}\n\nDiff Stat:\n${truncate(stat, 3000)}\n\nName Status:\n${truncate(nameStatus, 3000)}\n\nUnified Diff:\n${limitedDiff.diff}`
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
    review,
    diffCoverage: summarizeDiffCoverage(limitedDiff.coverage)
  }
}
