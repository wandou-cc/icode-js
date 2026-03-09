import { askAiJson } from '../core/ai-client.js'

function normalizeDecision(value) {
  const normalized = (value || '').trim().toLowerCase()
  if (['allow', 'warn', 'block'].includes(normalized)) {
    return normalized
  }
  return 'warn'
}

function normalizeRisk(value) {
  const normalized = (value || '').trim().toLowerCase()
  if (['low', 'medium', 'high'].includes(normalized)) {
    return normalized
  }
  return 'medium'
}

function truncate(value, limit) {
  if (!value || value.length <= limit) {
    return value
  }

  return `${value.slice(0, limit)}\n\n...<truncated>`
}

export async function runAiRiskReviewWorkflow({ git, context, currentBranch, targetBranches, profile }) {
  const stat = await git.diffStat()
  const nameStatus = await git.diffNameStatus()
  const recentLog = await git.logOneline('', 25)

  const { text, parsed } = await askAiJson(
    {
      systemPrompt: '你是资深发布风控助手。请根据改动给出 push 风险评估。输出 JSON。',
      userPrompt: `请仅返回 JSON：\n{\"decision\":\"allow|warn|block\",\"riskLevel\":\"low|medium|high\",\"reasons\":[\"...\"],\"checks\":[\"...\"]}\n\n仓库根目录: ${context.topLevelPath}\n当前分支: ${currentBranch}\n目标分支: ${targetBranches.join(', ')}\n\nDiff Stat:\n${truncate(stat, 2500)}\n\nName Status:\n${truncate(nameStatus, 2500)}\n\nRecent Commits:\n${truncate(recentLog, 2500)}`
    },
    {
      profile
    }
  )

  return {
    raw: text,
    decision: normalizeDecision(parsed.decision),
    riskLevel: normalizeRisk(parsed.riskLevel),
    reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [],
    checks: Array.isArray(parsed.checks) ? parsed.checks : []
  }
}
