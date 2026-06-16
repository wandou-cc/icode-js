/**
 * 输出主帮助文本，集中展示命令总览与常用示例。
 * 输入为空，输出为标准输出文本。
 */
export function printMainHelp() {
  process.stdout.write(`
icode v3 - Git workflow CLI

Usage:
  icode <command> [options]

Commands:
  ai          AI 助手能力（提交信息/冲突建议/代码评审）
  codereview  AI 代码评审（不带 ai 前缀）
  checkout    切换/创建分支（本地/远程自动识别）
  ready       检查仓库是否适合继续 save/push（适合 AI agent 读取）
  save        安全快速提交本地改动（检查 + add + commit）
  push        提交并推送，可合并到多个目标分支
  sync        批量同步分支（fetch + pull）
  clean       清理已合并分支（可删远程）
  undo        向导式撤销/回滚（revert/reset）
  migrate     迁移分支提交（cherry-pick）
  tag         创建并推送 tag（支持自动命名）
  config      查看和修改本地配置（含 AI profile）
  doctor      检查 Git/AI/远程合并配置健康状态
  explain     AI 解释 Git diff（自然语言）
  info        查看当前 git 与配置环境
  completion  生成 bash/zsh tab 补全脚本
  help        查看帮助（命令总览）

Global options:
  -d, --debug            开启调试日志（输出更多细节）
  -h, --help             查看帮助

Tips:
  icode <command> -h     查看子命令完整参数说明

Examples:
  icode checkout feature/login main --push-origin
  icode ready
  icode ready --json
  icode save -m "feat: add login form"
  icode save --ai-commit -y
  icode save -m "fix: adjust copy" --dry-run
  icode ai commit --apply -y
  icode ai codereview
  icode codereview --base origin/main --head HEAD
  icode explain --base origin/main --head HEAD
  icode push release test -m "feat: batch publish" -y
  icode push release test --ai-commit -y
  icode push release test -m "feat: keep merge commit" --local-merge -y
  icode push release test --dry-run
  icode sync --all-local --merge-main
  icode clean --remote --force -y
  icode undo a1b2c3d --mode revert -y
  icode undo --mode revert --ref HEAD~1 -y
  icode undo --recover abort
  icode migrate feature/login release --push -y
  icode migrate --interactive
  icode push --no-verify -m "chore: bypass hooks"
  icode config protect add main release
  icode doctor
  source <(icode completion zsh)
  icode info
`)
}
