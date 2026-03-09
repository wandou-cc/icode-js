import { IcodeError } from '../core/errors.js'
import { GitService } from '../core/git-service.js'
import { resolveGitContext } from '../core/git-context.js'
import { logger } from '../core/logger.js'
import { input } from '../core/prompts.js'

function todayStamp() {
  const now = new Date()
  const year = String(now.getFullYear())
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const date = String(now.getDate()).padStart(2, '0')
  return `${year}${month}${date}`
}

function nextDailyTag(existingTags, dateStamp) {
  const prefix = `v${dateStamp}_`
  const serials = existingTags
    .filter((tag) => tag.startsWith(prefix))
    .map((tag) => Number(tag.split('_')[1]))
    .filter((value) => Number.isFinite(value))

  const max = serials.length ? Math.max(...serials) : 0
  const next = String(max + 1).padStart(2, '0')
  return `${prefix}${next}`
}

export async function runTagWorkflow(options) {
  const context = await resolveGitContext({
    cwd: options.cwd,
    repoMode: options.repoMode
  })

  const git = new GitService(context)
  const dateStamp = todayStamp()
  const candidateTags = await git.listTags(`v${dateStamp}_*`)

  let tagName = options.tagName?.trim() || nextDailyTag(candidateTags, dateStamp)
  if (!options.tagName) {
    tagName = (await input('请输入 tag 名称', tagName)).trim() || tagName
  }

  if (!tagName) {
    throw new IcodeError('tag 名称不能为空。', {
      code: 'TAG_NAME_REQUIRED',
      exitCode: 2
    })
  }

  const message = options.message?.trim() || `release: ${tagName}`

  logger.info(`创建 tag: ${tagName}`)
  await git.createAnnotatedTag(tagName, message, options.fromRef)

  logger.info(`推送 tag: ${tagName}`)
  await git.pushTag(tagName, {
    noVerify: options.noVerify
  })

  return {
    repoRoot: context.topLevelPath,
    tagName,
    message
  }
}
