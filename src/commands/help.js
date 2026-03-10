export function printMainHelp() {
  process.stdout.write(`
icode v3 - Git workflow CLI

Usage:
  icode <command> [options]

Commands:
  ai          AI 助手能力（提交信息/冲突建议/代码评审）
  codereview  AI 代码评审（不带 ai 前缀）
  checkout    切换/创建分支（本地/远程自动识别）
  push        提交并推送，可合并到多个目标分支
  sync        批量同步分支（fetch + pull）
  clean       清理已合并分支（可删远程）
  undo        向导式撤销/回滚（revert/reset）
  migrate     迁移分支提交（cherry-pick）
  tag         创建并推送 tag（支持自动命名）
  config      查看和修改本地配置（含 AI profile）
  info        查看当前 git 与配置环境
  help        查看帮助（命令总览）

Global options:
  -d, --debug            开启调试日志（输出更多细节）
  -h, --help             查看帮助

Tips:
  icode <command> -h     查看子命令完整参数说明

Examples:
  icode checkout feature/login main --push-origin
  icode ai commit --apply -y
  icode ai codereview --base origin/main --head HEAD
  icode codereview --base origin/main --head HEAD
  icode push release test -m "feat: batch publish" -y
  icode push release test --ai-commit -y
  icode push release test -m "feat: keep merge commit" --local-merge -y
  icode sync --all-local --merge-main
  icode clean --remote --force -y
  icode undo --mode revert --ref HEAD~1 -y
  icode undo --recover abort
  icode migrate feature/login release --push -y
  icode migrate --interactive
  icode push --no-verify -m "chore: bypass hooks"
  icode config protect add main release
  icode info
`)
}
