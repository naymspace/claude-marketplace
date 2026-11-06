---
name: mr-review
description: Reviews a GitLab merge request (gitlab.naymspace.de) against its ticket, the project's patterns and possible regressions – in a dedicated worktree with its own environment. Use for "review MR", "code-review for !123", or an MR URL with a review request. Feedback only, no code changes.
argument-hint: <MR-URL> [more MR-URLs]
---

# MR Review

Goal: reliable review feedback on a merge request. **No code changes, no commit, no push, no GitLab comments without approval.**

Several MRs → one sub-agent per MR, each with its own worktree and environment.

## 1. Worktree & environment

- Create a dedicated worktree for the MR branch (`git fetch origin <branch>` + `git worktree add`). Never work in the main checkout or in another session's worktree.
- Set it up as described in `## Worktree Setup` of the project's CLAUDE.md (compose project name, ports, env files). Section missing: ask, don't guess.
- Only start the environment if the review needs it (specs, boot, UI check). Pure code analysis works without it.

## 2. Read ticket & MR

- Read the MR (`glab mr view <iid>` + discussions) and the linked ticket **including all comments** completely before asking questions.
- Check the MR's target branch (stacked MRs may not target `develop`). Review only the diff against that target branch.
- **Images/attachments: do not download, do not open, do not guess their content** (PII). List them instead: where (description / which comment) and file name. The user provides them or explicitly allows the download. Until then, mark requirements that depend on images as "unclear (image missing)".

## 3. Code review

- Run `/code-review` on the MR diff (target branch...HEAD in the worktree).
- Validate every finding against the code yourself; drop false positives instead of reporting them.

Additionally check:

- **Requirements:** every ticket requirement individually → met / not met / unclear, each with `file:line`.
- **Regressions:** what can break because of the change (existing callers, specs/tests, migrations)? Back it up with `git grep`.
- **Project checklist:** work through `## Review Checklist` of the project's CLAUDE.md. Skip items the diff doesn't touch – don't list them as "not applicable".
  - Section missing: derive a checklist from the stack and existing patterns, say so explicitly in the result, and suggest adding the section.
- **N+1 / query load** in new or changed queries and views.
- **I18N:** new UI texts in all languages of the project.

Verify instead of guessing: anything that can be settled with a tool call (read a file, grep, run the affected specs) gets checked. Locally run only the affected specs/tests, not the whole suite.

## 4. Result

Bullet points, no prose:

- **Requirements:** met / not met / unclear
- **Findings:** sorted by severity, each with `file:line`, the problem and why it is one
- **Regressions**
- **Open / not checked:** with the reason it couldn't be checked
- **Images the user needs to provide** (if any)

Mark assumptions with "Assumption:". Answer in the user's language.

## 5. GitLab comments (only when asked)

- Show a draft first, post only after approval.
- Inline comments as DiffNote via `glab api` on `merge_requests/<iid>/discussions` with `position[base_sha|start_sha|head_sha]` taken from the MR's `diff_refs`, plus `position[new_path]` + `position[new_line]`.

## 6. Clean up

- Shut down your own environment (only your own compose project name).
- Remove the worktree (`git worktree remove`) if it contains nothing uncommitted. Otherwise ask.
- Briefly report what was cleaned up.
