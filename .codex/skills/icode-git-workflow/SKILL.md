---
name: icode-git-workflow
description: Use this skill when users want to run Git submission workflows through icode-js CLI, including branch checkout/create, commit+push, multi-target merge push, undo/recover, migrate/cherry-pick, sync/clean/tag, and AI-assisted commit/conflict/codereview. Also use this skill when users ask to configure AI providers (OpenAI/Anthropic/Ollama) or set persistent command defaults with `icode config ai options`. Trigger on requests like “帮我提交代码”, “回滚”, “迁移分支内容”, “做 codereview”, “配置 AI 提交参数”.
---

# Icode Git Workflow

## Overview

Drive safe, repeatable Git operations via `icode-js` instead of hand-writing raw Git command chains. Prefer explicit command previews and concise execution summaries.

## Resolve Entry Command

Identify the runnable CLI first:

1. Run `which icode`.
2. Use `icode` when globally installed.
3. Use `node bin/icode.js` when running inside project source.

Use `<icode>` below as the resolved entry command.

## Run Baseline Checks

Before mutating operations, run:

1. `<icode> info --repo-mode auto`
2. `git status --short --branch`

Use `--repo-mode strict` only when the user explicitly wants to block inherited parent-repo execution.

## Execute by Intent

Map user intent to the exact command class:

- Commit/push current branch: `<icode> push -m "<msg>" [-y]`
- AI 自动提交后再推送: `<icode> push --ai-commit [-y]`
- AI 自动提交并远程合并多个目标分支: `<icode> push release test --ai-commit -y -o`
- AI commit message generation: `<icode> ai commit [--apply] [--profile <name>]`
- AI code review: `<icode> ai codereview [--base ... --head ... --profile ...]`
- Branch migration/cherry-pick: `<icode> migrate <source> <target> [--range ...] [--push]`
- Undo/recover: `<icode> undo [--mode ... --ref ... --recover ...]`
- Cleanup merged branches: `<icode> clean [--remote] [--force]`
- Sync branches in bulk: `<icode> sync [--all-local] [--merge-main] [--push]`
- Tag release: `<icode> tag [--name ... --message ... --from ...]`

Load [references/command-map.md](references/command-map.md) when you need full option-level mapping.

## Apply AI Config and Defaults

When users ask to “默认带参数” or “减少重复输入”:

1. Configure profiles with `<icode> config ai set ...`.
2. Configure persistent command defaults with `<icode> config ai options ...`.
3. Keep CLI arguments higher priority than saved options.

Load [references/playbooks.md](references/playbooks.md) for copy-ready setup snippets.

## Observe Progress Output

Use runtime output to explain state clearly:

1. Wait spinner appears during AI HTTP calls.
2. AI commit prints generated commit title and commit id.
3. Push merge flow prints step logs: sync/push/merge/remote-merge.
4. Final push result prints per-branch status line.

If users dislike spinner animation, suggest `ICODE_NO_SPINNER=1`.

## Troubleshoot Quickly

Handle common issues with direct actions:

1. `AI profile 不存在`: run `<icode> config ai list`; then `config ai set/use`.
2. `AI profile xxx 缺少 apiKey`: set `--api-key` for OpenAI/Anthropic; Ollama local usually no key needed.
3. Merge rejected (`remote-merge-rejected`): pull/rebase target branch and retry push.
4. Protected branch skipped: confirm and rerun with `--force-protected` only when approved.
5. `--ai-review` is deprecated/no-op: remove it from command and from `config ai options push`.

## Safety Rules

Apply these execution constraints:

1. Avoid destructive undo mode (`icode undo --mode hard`) unless user explicitly confirms.
2. Avoid `--no-verify` unless user requests hook bypass.
3. Avoid `--force-protected` unless user explicitly approves protected-branch override.
4. When a command fails, report the failing step and propose the nearest safe fallback command.

## Response Format

After running commands, return:

1. Executed command(s) with key flags.
2. Outcome summary (success/blocked/conflict/skipped branches).
3. Next action suggestion only when useful.
