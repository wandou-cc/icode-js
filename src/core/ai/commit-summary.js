/**
 * Format an AI commit result so the commit id is kept on the first line and
 * multiline body content is preserved for later lines.
 */
export function formatAiCommitSummary(commitId, commitMessage) {
  const normalizedMessage = String(commitMessage || '').trim()

  if (!normalizedMessage) {
    return commitId ? String(commitId).trim() : '无标题'
  }

  if (!commitId) {
    return normalizedMessage
  }

  const [header, ...restLines] = normalizedMessage.split('\n')
  return [`${String(commitId).trim()} ${header}`, ...restLines].join('\n').trim()
}
