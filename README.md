# icode-js v3

`icode-js` 是一个面向 Git 日常操作的命令行工具。

这次版本是重写级重构，不复用旧的 `lerna + packages/*` 逻辑，目标是：

- 更稳定地处理复杂 Git 场景
- 更好支持 `husky/git hooks` 校验链路
- 默认识别“继承父级 Git 仓库”的目录结构
- 采用更现代的 Node 20+ ESM 架构（无运行时第三方依赖）

## 安装

```bash
npm i -g icode-js
```

## 快速开始

```bash
icode help # 查看命令总览
icode info
icode config ai list
```

## 全局参数

- `-h, --help`：查看帮助（也可 `icode <command> -h` 查看子命令参数）
- `-d, --debug`：开启调试日志（输出更多细节）

## AI 能力配置

先配置一个 AI profile（支持 OpenAI/Anthropic/Ollama 三种接口格式）：

```bash
icode config ai set openai \
  --format openai \
  --base-url https://api.openai.com/v1 \
  --api-key sk-xxx \
  --model gpt-4o-mini \
  --activate
```

Anthropic 示例：

```bash
icode config ai set claude \
  --format anthropic \
  --base-url https://api.anthropic.com/v1 \
  --api-key xxx \
  --model claude-3-5-sonnet-20241022 \
  --activate
```

Ollama 本地模型示例：

```bash
icode config ai set ollama \
  --format ollama \
  --base-url http://127.0.0.1:11434 \
  --model qwen2.5:7b \
  --activate
```

常用命令：

```bash
icode config ai list
icode config ai show
icode config ai use claude
icode config ai test
```

可选：为常用命令预设默认 options（命令行显式传参优先级更高）：

```bash
icode config ai options set commit --json '{"profile":"ollama","lang":"zh","yes":true}'
icode config ai options set codereview --json '{"profile":"ollama","base":"origin/main"}'
icode config ai options set push --json '{"aiProfile":"ollama","aiCommitLang":"zh"}'
```

## 核心命令

### checkout

```bash
icode checkout <branch> [base] [--push-origin] [--pull-main] [--repo-mode auto|strict]
```

- 本地存在分支: 直接切换
- 远程存在分支: 本地创建 tracking 分支并切换
- 都不存在: 从 `base` 或默认主分支创建

参数说明：

- `<branch>`：目标分支名（必填）
- `[base]`：新建分支基线，默认主分支
- `--push-origin`：新建分支后立即推送到 `origin`
- `--pull-main`：切换后同步主分支到当前分支
- `--repo-mode auto|strict`：仓库模式（自动继承父仓库/禁止继承）
- `--no-verify`：跳过 hook/husky 校验
- `-y, --yes`：自动确认（跳过交互提示）
- `-h, --help`：查看帮助

### push

```bash
icode push [targetBranch...] [-m "commit message"] [--ai-commit] [--pull-main] [--not-push-current]
```

示例：

```bash
icode push -m "feat: release" # 提交并推送当前分支
icode push release test -m "feat: batch publish" -y # 默认远程 rebase 推送到多个分支
icode push release test -m "feat: keep merge commit" --local-merge -y # 显式使用本地 merge 模式
```

- 自动 `add + commit + push`
- 支持 `--ai-commit` 在 push 前自动生成并应用 AI 提交信息
- 支持把当前分支合并到多个目标分支
- 默认使用远程 rebase 推送模式（`source:target`）；遇到 `non-fast-forward` 时会自动 `fetch` 并尝试临时 `rebase` 后再推送目标分支
- 可通过 `--local-merge` 切换为本地 merge 模式（会生成 merge commit）
- 支持受保护分支策略（通过 `icode config protect ...` 管理）

参数说明：

- `[targetBranch...]`：目标分支列表（可多个，空则默认当前分支）
- `-m, --message <msg>`：提交信息（未填会提示输入）
- `-y, --yes`：自动确认（跳过确认提示）
- `-o, --origin`：显式使用远程 rebase 推送模式（默认）
- `--local-merge`：使用本地 merge 模式（会切换分支并生成 merge commit）
- `--ai-commit`：push 前自动执行 AI commit
- `--ai-profile <name>`：指定 AI profile（用于 `--ai-commit`）
- `--pull-main`：提交前同步主分支到当前分支
- `--not-push-current`：不推送当前分支，只处理目标分支
- `--force-protected`：强制处理配置里的受保护分支
- `--repo-mode auto|strict`：仓库模式（自动继承父仓库/禁止继承）
- `--no-verify`：跳过 hook/husky 校验
- `-h, --help`：查看帮助

说明：
- `push` 的布尔开关（如 `--ai-commit`、`--pull-main`、`--no-verify`、`-y`）仅在命令行显式传入时生效。

### ai

```bash
icode ai commit [--apply]
icode ai conflict
icode ai codereview [--base origin/main --head HEAD]
icode codereview [--base origin/main --head HEAD]
```

- `ai commit`: 基于 diff 生成 Conventional Commit 信息，可直接应用 commit
- `ai conflict`: 解析冲突块并生成合并建议
- `ai codereview`: 针对 diff 范围生成评审报告

参数说明：

- `ai commit` 参数
  - `--apply`：直接使用 AI 信息执行 commit
  - `--lang <zh|en>`：输出语言（默认 zh）
  - `--profile <name>`：指定 AI profile
  - `--repo-mode auto|strict`：仓库模式（自动继承父仓库/禁止继承）
  - `--no-verify`：commit 时跳过 hook/husky 校验
  - `-y, --yes`：自动确认（跳过确认提示）
  - `-h, --help`：查看帮助
- `ai conflict` 参数
  - `--profile <name>`：指定 AI profile
  - `--repo-mode auto|strict`：仓库模式（自动继承父仓库/禁止继承）
  - `-h, --help`：查看帮助
- `ai codereview` / `codereview` 参数
  - `--base <ref>`：diff 基线（默认 `origin/<defaultBranch>`）
  - `--head <ref>`：diff 终点（默认 `HEAD`）
  - `--focus <text>`：评审重点（安全/性能/测试等）
  - `--profile <name>`：指定 AI profile
  - `--repo-mode auto|strict`：仓库模式（自动继承父仓库/禁止继承）
  - `--dump-response`：输出 AI 原始响应（调试数据格式）
  - `-h, --help`：查看帮助

### sync

```bash
icode sync [branch...] [--all-local] [--merge-main] [--push]
```

- 批量同步多个分支（fetch + pull）
- 可选自动同步全部本地分支（`--all-local`）
- 可选把主分支自动 merge 到目标分支（`--merge-main`）
- 可选同步后自动推送（`--push`）

参数说明：

- `[branch...]`：需要同步的分支列表（可多个）
- `--all-local`：自动同步全部本地分支
- `--merge-main`：同步后把主分支 merge 到目标分支
- `--rebase`：pull 时使用 rebase
- `--push`：同步后自动 push
- `-y, --yes`：自动确认（跳过确认提示）
- `--repo-mode auto|strict`：仓库模式（自动继承父仓库/禁止继承）
- `--no-verify`：push 时跳过 hook/husky 校验
- `-h, --help`：查看帮助

### clean

```bash
icode clean [--merged-target <branch>] [--remote] [--force]
```

- 安全清理“已合并”本地分支
- 默认保护当前分支/主分支/配置中的受保护分支
- 可选同步删除远程分支（`--remote`）

参数说明：

- `--merged-target <branch>`：基于该分支判断“已合并”状态
- `--keep <branch|csv>`：额外保留分支，可重复或逗号分隔
- `--remote`：同时删除远程分支
- `--force`：强制删除本地分支（`-D`）
- `-y, --yes`：自动确认（跳过确认提示）
- `--repo-mode auto|strict`：仓库模式（自动继承父仓库/禁止继承）
- `-h, --help`：查看帮助

### tag

```bash
icode tag [--name <tag>] [--message <msg>] [--from <ref>]
```

默认 tag 规则：`vYYYYMMDD_NN`（例如 `v20260309_01`）

参数说明：

- `-n, --name <tag>`：指定 tag 名（默认 `vYYYYMMDD_NN`）
- `-m, --message <msg>`：tag 备注
- `--from <ref>`：从指定分支/commit 创建 tag
- `--repo-mode auto|strict`：仓库模式（自动继承父仓库/禁止继承）
- `--no-verify`：跳过 hook/husky 校验
- `-h, --help`：查看帮助

### undo

```bash
icode undo [--mode revert|soft|mixed|hard] [--ref <ref>] [--recover continue|abort|keep]
```

- 向导式撤销命令（交互选择回滚策略）
- 适合新人或低频 Git 操作场景
- 也支持非交互参数：`--mode` + `--ref`
- 检测到 revert/cherry-pick 冲突时，会提示继续或中止

参数说明：

- `--mode <mode>`：回滚模式（`revert|soft|mixed|hard`）
- `--ref <ref>`：回滚目标，默认按 mode 自动给出
- `--recover <action>`：冲突恢复策略（`continue|abort|keep`）
- `-y, --yes`：自动确认（跳过确认提示）
- `--repo-mode auto|strict`：仓库模式（自动继承父仓库/禁止继承）
- `-h, --help`：查看帮助

### migrate

```bash
icode migrate <sourceBranch> <targetBranch> [--range <from..to>] [--push]
```

- 将 source 分支的提交迁移到 target（底层是 `cherry-pick`）
- 默认迁移 `target..source` 的增量提交
- 可通过 `--range` 精确指定迁移范围

参数说明：

- `<sourceBranch>`：迁移来源分支
- `<targetBranch>`：迁移目标分支
- `-i, --interactive`：交互模式（单选/多选 source/target 与迁移范围）
- `--range <from..to>`：指定提交范围，例如 `main..feature-x`
- `--push`：迁移后自动推送 target 分支
- `-y, --yes`：自动确认（跳过确认提示）
- `--repo-mode auto|strict`：仓库模式（自动继承父仓库/禁止继承）
- `--no-verify`：推送时跳过 hook/husky 校验
- `-h, --help`：查看帮助

### config

```bash
icode config list
icode config get defaults.repoMode
icode config set defaults.repoMode strict
icode config protect add main release
icode config protect list
```

参数说明：

- `list`：查看全部配置
- `get <path>`：读取指定配置项
- `set <path> <value>`：写入配置项（支持数字/布尔/JSON）
- `delete <path>`：删除配置项
- `protect list`：查看受保护分支
- `protect add <branch...>`：添加受保护分支
- `protect remove <branch...>`：移除受保护分支
- `ai <subcommand>`：AI profile 管理（见上文“AI 能力配置”）
- `--repo-mode auto|strict`：仓库模式（仅影响 protect）
- `-h, --help`：查看帮助

### info

```bash
icode info
```

输出 Git 版本、仓库根路径、当前分支、hook/husky 状态、受保护分支等信息。

## 复杂场景支持

### 1) Husky / Git Hook 校验

当 `commit`/`push` 被 hooks 拦截时，会明确提示：

- 当前被 hook 拦截
- 可使用 `--no-verify` 进行跳过

示例：

```bash
icode push -m "chore: hotfix" --no-verify
```

### 2) 继承父级 Git 仓库

当你在子目录执行命令，而 `.git` 在父目录：

- 默认 `--repo-mode auto`：自动定位到父仓库根目录执行
- `--repo-mode strict`：检测到继承时直接阻断，避免误操作

## 开发

```bash
npm test
node bin/icode.js help
node bin/icode.js undo
```

## 迁移说明（v2 -> v3）

- 移除了旧版远程平台 API 合并流程（GitHub/GitLab/Gitee Token 管理）
- 统一聚焦本地 Git 工作流自动化
- 部分旧参数仍做兼容映射（如 `-pm`）
