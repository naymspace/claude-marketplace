---
name: dep-review
description: Reviews dependency MRs (Renovate) on gitlab.naymspace.de – real diff, changelog, usage in our code, risk-based verification depth, recommendation. Use for "check this dependency MR", Renovate MR URLs, or a list of update MRs. Stack-neutral; project-specific commands come from the project's CLAUDE.md.
argument-hint: <MR-URL> [more MR-URLs]
---

# Dependency MR Review

Goal: recommendation merge / adjust / don't merge – backed by evidence, not assumptions. **No commit, no push, no merge, no comments without approval.**

Several MRs → one sub-agent per MR, each with its own worktree and environment. At the end, one overview (one line per MR: package, versions, recommendation).

## 1. Worktree & environment

- Create a dedicated worktree for the MR branch. Never in the main checkout or in another session's worktree.
- Set it up as described in `## Worktree Setup` of the project's CLAUDE.md. Section missing: ask, don't guess.

## 2. Real diff

- Fetch the diff via `glab api "projects/:id/merge_requests/<iid>/diffs"` (outside the repo: URL-encoded project path + `GITLAB_HOST=gitlab.naymspace.de`).
- Compare title and content – Renovate sometimes titles an update that doesn't actually happen in the lockfile.
- List packages pulled in along the way (bycatch), with their version jumps.

## 3. Changelog & usage

- Read the changelog of all versions between old and new (not only the target version).
- For every relevant change: do we use it? Back it up with `git grep`, name files + lines. No hits → state which search pattern was used.

## 4. Risk-based depth

Pick a level **and justify why it is sufficient**:

1. **Touches nothing we use** (dev/test tool, disabled service, file nobody builds) → code analysis is enough, run nothing.
2. **Runs as part of our code** → install, boot in **production mode**, run the affected specs/tests. Configuration that is only active in production is otherwise not tested.
3. **Native extension, autoloader/compile, asset pipeline, Docker base image** → additionally fully load/compile, or run exactly the build that actually uses it.

The concrete commands per level are in `## Dependency Checks` of the project's CLAUDE.md. Section missing: derive equivalents from the stack, say explicitly in the result that they were derived, and suggest adding the section.

Afterwards reset the working tree (lockfile/build artifacts).

## 5. Pipeline

- Red pipeline: ignore jobs with `allow_failure` (listed in `## Dependency Checks` of the project's CLAUDE.md). Other red jobs: read the log, name the cause, compare with `develop` (was the job already red there?).

## 6. Result (bullet points)

- **What changes**
- **Do we use it, where** (`file:line`)
- **Does it affect us**
- **To adjust**
- **Verified** – only what you actually ran in this pass, with the command
- **Recommendation**

Claim nothing about our code that wasn't checked in this pass. State explicitly what couldn't be clarified – don't guess. Answer in the user's language.

## 7. Clean up

- Shut down your own environment (only your own compose project name), remove the worktree.
- Briefly report what was cleaned up.
