# Command Map

## Entry Command

Use one of the following:

- Global install: `icode`
- Source checkout: `node bin/icode.js`

## Repository State and Policy

- Inspect environment: `<icode> info --repo-mode auto`
- Show config: `<icode> config list`
- Protect branches:
  - `<icode> config protect list`
  - `<icode> config protect add main release`
  - `<icode> config protect remove release`

## Branch and Submission Workflows

- Checkout/create branch:
  - `<icode> checkout <branch> [base] [--push-origin] [--pull-main]`
- Commit + push:
  - `<icode> push -m "<message>" [-y]`
- AI commit + push:
  - `<icode> push --ai-commit [-y]`
- Push + merge to multiple branches:
  - Local merge mode: `<icode> push <target...> -m "<message>" -y`
  - Remote merge mode: `<icode> push <target...> -m "<message>" -y -o`
  - Remote merge with AI commit: `<icode> push <target...> --ai-commit -y -o [--ai-review]`
- Common push control flags:
  - `--not-push-current`
  - `--pull-main`
  - `--ai-commit`
  - `--ai-review`
  - `--ai-profile <name>`
  - `--force-protected`
  - `--no-verify`

## Recovery and Cleanup

- Rollback:
  - `<icode> rollback [ref] [--mode revert|soft|mixed|hard] [-y]`
- Guided undo:
  - `<icode> undo [--mode ... --ref ... --recover continue|abort|keep]`
- Migrate commits:
  - `<icode> migrate <source> <target> [--range <spec>] [--push]`
- Sync branches:
  - `<icode> sync [branch...] [--all-local] [--merge-main] [--rebase] [--push]`
- Clean merged branches:
  - `<icode> clean [--merged-target <branch>] [--keep <csv>] [--remote] [--force]`
- Tag:
  - `<icode> tag [--name <tag>] [--message <msg>] [--from <ref>]`

## AI Workflows

- Generate commit message:
  - `<icode> ai commit [--apply] [--lang zh|en] [--profile <name>]`
- Conflict suggestion:
  - `<icode> ai conflict [--profile <name>]`
- Code review:
  - `<icode> ai codereview [--base <ref>] [--head <ref>] [--focus <text>] [--profile <name>]`
  - `<icode> codereview [--base <ref>] [--head <ref>] [--focus <text>] [--profile <name>]`

## AI Configuration

- Profile lifecycle:
  - `<icode> config ai list`
  - `<icode> config ai show [profile]`
  - `<icode> config ai set <profile> --format <openai|anthropic|ollama> --base-url <url> --api-key <key> --model <name> [--headers <json>] [--activate]`
  - `<icode> config ai use <profile>`
  - `<icode> config ai remove <profile>`
  - `<icode> config ai test [profile]`

- Persistent AI options:
  - `<icode> config ai options list`
  - `<icode> config ai options show <commit|conflict|codereview|push>`
  - `<icode> config ai options set <scope> --json '<json>' [--replace]`
  - `<icode> config ai options remove <scope>`

## Output Signals

- AI request in progress: spinner line `[icode] -|/\\ 等待 AI(<profile>) 响应`
- AI commit success: `AI 自动提交完成: <commitId> <commitTitle>`
- Remote merge progress: `远程合并开始: <source> -> <target>`
- Per-branch summary: `[结果] <branch>: <status>`
