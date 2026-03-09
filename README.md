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
icode help
icode info
icode config ai list
```

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
icode config ai options set push --json '{"aiCommit":true,"aiReview":true,"aiProfile":"ollama","yes":true}'
```

## 核心命令

### checkout

```bash
icode checkout <branch> [base] [--push-origin] [--pull-main] [--repo-mode auto|strict]
```

- 本地存在分支: 直接切换
- 远程存在分支: 本地创建 tracking 分支并切换
- 都不存在: 从 `base` 或默认主分支创建

### push

```bash
icode push [targetBranch...] [-m "commit message"] [--ai-commit] [--pull-main] [--not-push-current] [-o]
```

- 自动 `add + commit + push`
- 支持 `--ai-commit` 在 push 前自动生成并应用 AI 提交信息
- 支持把当前分支合并到多个目标分支
- 支持 `-o/--origin` 远程合并模式（`source:target`）
- 支持 `--ai-review` 推送前 AI 风险评审
- 支持受保护分支策略（通过 `icode config protect ...` 管理）

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

### sync

```bash
icode sync [branch...] [--all-local] [--merge-main] [--push]
```

- 批量同步多个分支（fetch + pull）
- 可选自动同步全部本地分支（`--all-local`）
- 可选把主分支自动 merge 到目标分支（`--merge-main`）
- 可选同步后自动推送（`--push`）

### clean

```bash
icode clean [--merged-target <branch>] [--remote] [--force]
```

- 安全清理“已合并”本地分支
- 默认保护当前分支/主分支/配置中的受保护分支
- 可选同步删除远程分支（`--remote`）

### tag

```bash
icode tag [--name <tag>] [--message <msg>] [--from <ref>]
```

默认 tag 规则：`vYYYYMMDD_NN`（例如 `v20260309_01`）

### rollback

```bash
icode rollback [ref] [--mode revert|soft|mixed|hard]
```

- `revert`：生成反向提交，安全回滚（默认）
- `soft/mixed/hard`：基于 `git reset` 的不同回滚级别

### undo

```bash
icode undo [--recover continue|abort|keep]
```

- 向导式撤销命令（交互选择回滚策略）
- 适合新人或低频 Git 操作场景
- 内部最终落到 `rollback` 能力
- 检测到 revert/cherry-pick 冲突时，会提示继续或中止

### migrate

```bash
icode migrate <sourceBranch> <targetBranch> [--range <from..to>] [--push]
```

- 将 source 分支的提交迁移到 target（底层是 `cherry-pick`）
- 默认迁移 `target..source` 的增量提交
- 可通过 `--range` 精确指定迁移范围

### config

```bash
icode config list
icode config get defaults.repoMode
icode config set defaults.repoMode strict
icode config protect add main release
icode config protect list
```

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
