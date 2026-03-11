import { askAi } from '../core/ai-client.js'
import { resolveAiDiffRange } from '../core/ai-diff-range.js'
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

export async function runAiExplainWorkflow(options) {
  const context = await resolveGitContext({
    cwd: options.cwd,
    repoMode: options.repoMode
  })
  const git = new GitService(context)

  const headRef = options.headRef || 'HEAD'
  const explicitBase = Boolean((options.baseRef || '').trim())
  const explicitHead = Boolean((options.headRef || '').trim())
  const explicitRange = explicitBase || explicitHead

  let rangeSpec = ''
  let diff = ''
  let stat = ''
  let nameStatus = ''
  let diffSource = 'three-dot-range'
  let rangeError = null

  try {
    const rangeResult = await resolveAiDiffRange({
      git,
      context,
      baseRef: options.baseRef,
      headRef,
      explicitHead,
      label: 'Explain'
    })
    rangeSpec = rangeResult.rangeSpec
    diff = rangeResult.diff
  } catch (error) {
    rangeError = error
  }

  if (diff.trim()) {
    stat = await git.diffStat(rangeSpec)
    nameStatus = await git.diffNameStatus(rangeSpec)
  } else {
    if (rangeError && explicitRange) {
      throw rangeError
    }

    const stagedDiff = await git.diffStaged()
    const workingDiff = await git.diffWorkingTree()

    if (rangeError && !stagedDiff.trim() && !workingDiff.trim()) {
      throw rangeError
    }

    if (!stagedDiff.trim() && !workingDiff.trim()) {
      throw new IcodeError(`范围 ${rangeSpec} 内没有代码差异，且暂存区/工作区也没有改动。`, {
        code: 'AI_EXPLAIN_EMPTY_DIFF',
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

  const explanation = await askAi(
    {
      systemPrompt: '你是资深软件工程师，擅长把 Git diff 用自然语言讲清楚。',
      userPrompt: `请用中文自然语言解释以下 Git diff，输出简洁清晰，面向不熟悉代码的同事。\n要求：\n1. 先给整体改动概览\n2. 再按文件或模块说明主要改动\n3. 如有可能影响行为/兼容性/风险点，请指出但不要过度推测\n4. 不要输出 JSON 或代码块，只输出自然语言（可用简短项目符号）\n\nRange: ${rangeSpec}\nDiff Source: ${diffSource}\n\nDiff Stat:\n${truncate(stat, 3000)}\n\nName Status:\n${truncate(nameStatus, 3000)}\n\nUnified Diff:\n${truncate(diff, 18000)}`
    },
    {
      profile: options.profile,
      dumpResponse: options.dumpResponse
    }
  )

  if (!explanation || !explanation.trim()) {
    throw new IcodeError('AI Explain 返回为空，请检查 AI profile/model 是否可用后重试。', {
      code: 'AI_EXPLAIN_EMPTY_RESPONSE',
      exitCode: 2
    })
  }

  return {
    rangeSpec,
    explanation
  }
}
