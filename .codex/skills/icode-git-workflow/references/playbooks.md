# Playbooks

## 1) Initialize Local AI Submit Defaults

Configure Ollama and command defaults once:

```bash
<icode> config ai set ollama-local \
  --format ollama \
  --base-url http://127.0.0.1:11434 \
  --model glm-5:cloud \
  --activate

<icode> config ai options set commit --json '{"profile":"ollama-local","lang":"zh","yes":true}'
<icode> config ai options set codereview --json '{"profile":"ollama-local","base":"origin/main"}'
<icode> config ai options set push --json '{"aiCommit":true,"aiProfile":"ollama-local","yes":true}'
```

Run direct commands after setup:

```bash
<icode> ai codereview
<icode> push release test --ai-commit -y -o
```

## 2) Submit Current Branch and Merge into Release/Test

Prefer remote merge mode when team process requires server-side merge:

```bash
<icode> push release test --ai-commit -y -o
```

Use local merge mode when local branch switching/merge is acceptable:

```bash
<icode> push release test -m "feat: batch publish" -y
```

## 3) Recover from Bad Commit

Safe undo (recommended default):

```bash
<icode> undo --mode revert --ref HEAD~1 -y
```

Hard reset (only with explicit user confirmation):

```bash
<icode> undo --mode hard --ref HEAD~1 -y
```

## 4) Migrate Feature Commits into Target Branch

Migrate all incremental commits from source to target:

```bash
<icode> migrate feature/login release --push -y
```

Migrate a specific range:

```bash
<icode> migrate feature/login release --range HEAD~3..feature/login --push -y
```

## 5) Handle Hook and Parent-Repo Scenarios

When hooks block commit/push and user explicitly chooses bypass:

```bash
<icode> push -m "chore: hotfix" --no-verify -y
```

When user wants to forbid inherited parent Git repository execution:

```bash
<icode> info --repo-mode strict
```

## 6) Fix "AI profile 不存在"

```bash
<icode> config ai list
<icode> config ai set ollama --format ollama --base-url http://127.0.0.1:11434 --model glm-5:cloud --activate
<icode> config ai test ollama
<icode> push release test --ai-commit -o -y --ai-profile ollama
```
