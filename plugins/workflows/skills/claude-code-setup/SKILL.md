---
name: claude-code-setup
description: Bootstrap Claude Code config in a naymspace gitlab project. Clones project to a tmp dir, detects existing Claude setup, applies/updates template settings (.claude/settings.json, CLAUDE.md, .gitignore), shows diff, commits to a new branch and pushes, optionally opens MR. Use when user says "set up claude code in <project>", "claude-code-setup", or wants baseline Claude config in a repo.
---

# claude-code-setup

Bootstrap baseline Claude Code config in a naymspace GitLab project. Always operates in an isolated tmp checkout so secrets from the user's working directory cannot leak.

GitLab host: `gitlab.naymspace.de`.

Templates live in `${CLAUDE_PLUGIN_ROOT}/skills/claude-code-setup/templates/`:
- `settings.json` → project's `.claude/settings.json`
- `CLAUDE.md` → project's `CLAUDE.md`
- `gitignore.snippet` → lines to append to project's `.gitignore`

`.mcp.json` is intentionally NOT part of this skill. After baseline lands, suggest setting up MCP servers (e.g. `playwright`) as a separate follow-up.

## Workflow

Run these steps in order. Stop and surface errors to the user immediately.

### 1. Preflight `glab`

```bash
command -v glab
```

If missing: tell user to install (`mise use -g glab` if mise present, otherwise distro package manager or https://gitlab.com/gitlab-org/cli) and stop.

```bash
glab auth status
```

If not logged in to `gitlab.naymspace.de`: tell user to run `glab auth login --hostname gitlab.naymspace.de` and stop.

### 2. Ask user for project

Accept any of:
- `group/project` slug
- Full SSH URL (`git@gitlab.naymspace.de:group/project.git`)
- Full HTTPS URL (`https://gitlab.naymspace.de/group/project`)
- `search` keyword → run `glab repo list --per-page 50 --archived=false` (or `glab api projects?search=<term>&membership=true`) and let user pick

### 3. Clone to tmp

```bash
WORKDIR=$(mktemp -d -t claude-setup-XXXX)
cd "$WORKDIR"
glab repo clone <ref>
cd <repo-name>
```

Record the absolute repo path. NEVER edit anything outside `$WORKDIR`. The current Claude Code working dir is off-limits for this skill.

### 4. Detect existing Claude setup

Check for any of:
- `.claude/`
- `.claude/settings.json`
- `CLAUDE.md`
- `.claude/CLAUDE.md`

**Fresh repo** (none exist): tell user "no existing Claude setup, applying baseline" and proceed.

**Existing setup**: list which files exist with sizes + last commit (`git log -1 --format="%ai" -- <file>`). Tell user the project already has Claude config and ask: **update to current skill templates** or **abort**. On abort, clean up `$WORKDIR` and stop.

### 5. Create branch

```bash
DEFAULT=$(git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@')
git checkout "$DEFAULT" && git pull --ff-only
git checkout -b chore/claude-code-setup
```

### 6. Apply templates

For each target — `.claude/settings.json` and `CLAUDE.md`:

- **Missing** → copy template in place (mkdir parent if needed).
- **Exists** → show diff (`diff -u <existing> <template>`). Ask user per file:
  - **merge** (settings.json only): deep-merge template into existing — existing values win on key conflicts, new keys and any new `permissions.deny` entries get added (dedupe). Show merged content for review before writing.
  - **overwrite** — replace with template.
  - **skip** — leave untouched.
  - **edit manually** — ask what to change, apply via Edit tool.

`.gitignore` handling — never overwrite, but ALWAYS process every line in `templates/gitignore.snippet`. Do not skip the snippet wholesale. Algorithm:

1. If `.gitignore` does not exist: create it.
2. Read existing `.gitignore` lines into a set.
3. For each non-empty line in `templates/gitignore.snippet` (including the `# Claude Code` header):
   - If exact match already present: skip that line.
   - Else: append.

### 7. Show diff

```bash
git add -A
git status
git diff --staged
```

Summarize for user.

### 8. Confirm commit + push

Ask user: commit and push to `origin chore/claude-code-setup`? (yes/no)

- **yes**: 
  ```bash
  git commit -m "chore: add Claude Code baseline config"   # or "update" if existing setup modified
  git push -u origin chore/claude-code-setup
  ```
- **no**: print `$WORKDIR` path, stop. Skip cleanup so user can inspect.

### 9. MR prompt

After successful push, ask user: open MR?

- **yes**:
  ```bash
  glab mr create --fill --remove-source-branch
  ```
  Print the MR URL from the command output.
- **no**: print branch name + suggest `glab mr create` later.

### 10. Offer follow-up work in tmp dir

Baseline is now in `$WORKDIR`. Tell user the tmp checkout is still available and offer to do follow-up work in place — cheaper than another clone, still secret-isolated. Ask which (multi-select) the user wants to do now:

- **Fill out CLAUDE.md** — template only has TODO comments. Inspect the project (stack, package manager, test/lint commands, conventions, constraints) and replace TODOs with real content. Show diff, let user tweak, then offer follow-up commit (`docs: fill out CLAUDE.md` on same branch, push, amend MR if open).
- **Set up MCP servers** — create/edit `.mcp.json` (e.g. `playwright`) per project needs. Show diff, follow-up commit (`chore: add MCP server config`), push, amend MR.
- **Nothing, clean up** — proceed to step 11.

For each follow-up: same diff → confirm → commit → push pattern as steps 7-9. Stay on branch `chore/claude-code-setup`.

### 11. Cleanup

Before deleting `$WORKDIR`, ask user explicitly: "Cleanup `$WORKDIR` now? (yes/no)". Default no when in doubt.

- **yes**: `rm -rf "$WORKDIR"`.
- **no**: print absolute path so user can keep working there.

If commit + push never happened (user said no in step 8), always skip cleanup and print path.

## Notes

- The settings template's `permissions.deny` list is the safety floor. When merging into an existing `settings.json`, never remove existing deny entries — only add missing ones.
- `plansDirectory` (`.claude/plans`) is intentionally committable — plans are shared, not local-only. Do not add it to `.gitignore`.
- If `glab repo clone` fails (private project, no SSH key, etc.), surface the exact error to the user; don't retry blindly.
