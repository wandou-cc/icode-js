import { parseArgs } from 'node:util'
import { normalizeLegacyArgs } from '../core/args.js'
import { logger } from '../core/logger.js'
import { runTagWorkflow } from '../workflows/tag-workflow.js'

function printHelp() {
  process.stdout.write(`
Usage:
  icode tag [options]

Options:
  -n, --name <tag>         指定 tag 名（默认 vYYYYMMDD_NN）
  -m, --message <msg>      tag 备注
  --from <ref>             从指定分支/commit 创建 tag
  --repo-mode <mode>       仓库模式: auto(自动继承父仓库) | strict(禁止继承)
  --no-verify              跳过 hook/husky 校验
  -h, --help               查看帮助

Notes:
  默认 tag 规则: vYYYYMMDD_NN（例如 v20260309_01）。
`)
}

export async function runTagCommand(rawArgs) {
  const args = normalizeLegacyArgs(rawArgs)
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      name: { type: 'string', short: 'n' },
      message: { type: 'string', short: 'm' },
      from: { type: 'string' },
      'repo-mode': { type: 'string', default: 'auto' },
      'no-verify': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false }
    }
  })

  if (parsed.values.help) {
    printHelp()
    return
  }

  const result = await runTagWorkflow({
    tagName: parsed.values.name,
    message: parsed.values.message,
    fromRef: parsed.values.from,
    repoMode: parsed.values['repo-mode'],
    noVerify: parsed.values['no-verify']
  })

  logger.success(`tag 完成: ${result.tagName}`)
}
