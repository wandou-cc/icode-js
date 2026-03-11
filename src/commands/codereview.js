import { parseArgs } from 'node:util'
import { logger } from '../core/logger.js'
import { runAiCodeReviewWorkflow } from '../workflows/ai-codereview-workflow.js'

function printHelp() {
  process.stdout.write(`
Usage:
  icode codereview [options]

Options:
  --base <ref>            指定分支 diff 基线；未传时默认评审暂存区 + 工作区改动
  --head <ref>            指定分支 diff 终点，默认 HEAD
  --focus <text>          评审重点（安全/性能/测试等）
  --profile <name>        指定 AI profile
  --repo-mode <mode>      仓库模式: auto(自动继承父仓库) | strict(禁止继承)
  --dump-response         输出 AI 原始响应（调试数据格式）
  -h, --help              查看帮助
`)
}

export async function runCodeReviewCommand(rawArgs) {
  const parsed = parseArgs({
    args: rawArgs,
    allowPositionals: true,
    options: {
      base: { type: 'string' },
      head: { type: 'string' },
      focus: { type: 'string' },
      profile: { type: 'string' },
      'repo-mode': { type: 'string' },
      'dump-response': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    }
  })

  if (parsed.values.help) {
    printHelp()
    return
  }

  const result = await runAiCodeReviewWorkflow({
    baseRef: typeof parsed.values.base === 'string' ? parsed.values.base : '',
    headRef: typeof parsed.values.head === 'string' ? parsed.values.head : '',
    focus: typeof parsed.values.focus === 'string' ? parsed.values.focus : '',
    profile: typeof parsed.values.profile === 'string' ? parsed.values.profile : '',
    repoMode: typeof parsed.values['repo-mode'] === 'string' ? parsed.values['repo-mode'] : 'auto',
    dumpResponse: parsed.values['dump-response'] === true
  })

  logger.info(`Code Review 范围: ${result.rangeSpec}`)
  process.stdout.write(`\n${result.review}\n`)
}
