export function printMainHelp() {
  process.stdout.write(`
icode v3 - Git workflow CLI

Usage:
  icode <command> [options]

Commands:
  ai          AI 助手能力（commit/review/conflict）
  codereview  AI 代码评审
  checkout    切换/创建分支
  push        提交并推送，可合并到多个目标分支
  sync        批量同步分支
  clean       清理已合并分支
  rollback    回滚提交（revert/reset）
  undo        向导式撤销/回滚
  migrate     迁移分支提交（cherry-pick）
  tag         创建并推送 tag
  config      查看和修改本地配置
  info        查看当前 git 与配置环境
  help        查看帮助

Global options:
  -d, --debug            开启调试日志
  -h, --help             查看帮助

Examples:
  icode checkout feature/login main --push-origin
  icode ai commit --apply -y
  icode ai codereview --base origin/main --head HEAD
  icode codereview --base origin/main --head HEAD
  icode push release test -m "feat: batch publish" -y -o --ai-review
  icode push release test --ai-commit -y -o --ai-review
  icode sync --all-local --merge-main
  icode clean --remote --force -y
  icode rollback HEAD~1 --mode revert
  icode undo --recover abort
  icode migrate feature/login release --push -y
  icode push --no-verify -m "chore: bypass hooks"
  icode config protect add main release
  icode info
`)
}
