---
name: thin-tests
description: Thin a test suite: audit what each test protects, delete or condense the rest, replace per-entity spot checks with generated matrix tests. Use when asked whether tests are needed, to cut or consolidate tests ("Tests ausdünnen"), or when a change is mostly tests.
---

# Thin tests

The goal is a smaller suite that protects at least as much: every deleted test names the test that still covers it, and every new generic test has been seen going red.

Verdicts and their criteria live in [`criteria.md`](criteria.md); every audit and thinning brief points the agent there.

## 1. Scope

Fix the target (a branch or pull request diff against its base, or given paths) and list every test file in it with lines and test count. Note which tests CI runs (tags, skips, excludes, CI config), and which tests only became necessary because of the change versus pre-existing ones.

Done when the list covers every test file in the target and the total is known.

## 2. Audit

Read-only. Split the files into groups that can be judged together, typically:

- cross-checks against another source of truth (parity, golden files)
- engine and contract tests of shared infrastructure
- security, authorization, isolation
- per-entity tests (one file per model, resource, endpoint, component)

Dispatch one subagent per group, in one message. Each brief names its files, lists every other test file of the target for overlap checks, points at `criteria.md`, and asks for: per file and per test group (the framework's `describe`, `context`, class or module) the lines, test count, what it protects, overlap, regression signal from git history, verdict with a one-line reason; then gaps, proposals for **matrix** tests, removable lines, and the 3–5 most important tests.

Done when every test group of every file has a verdict.

## 3. Recommend

Consolidate the reports for the user: removable share, what is important, what is unnecessary and why, gaps, proposed matrix tests. Stop here and let the user decide; thinning starts only on their go.

## 4. Matrix first

Write the generated **matrix** tests before deleting the spot checks they replace: iterate the registry the code already has (route table, model or resource list, plugin registry, config schema) so a new entity is covered automatically, and pin the rules themselves in one literal table so a rule change shows up in review.

Prove each matrix test by mutation: switch off the rule it guards in the production code, run it, see it go **red**, restore the code. A matrix test that stays green under its mutation protects nothing.

Done when every behaviour the thinning will delete as "covered by the matrix" is listed against a matrix test that went red for it.

## 5. Thin

Dispatch one subagent per group again, each owning a disjoint set of files (other agents edit other files at the same time). Each brief carries the decided verdicts per test, points at `criteria.md`, and states the rules: keep the intent of kept tests, fold copies into tables, assert stable codes over full messages, no commits, run and format only its own files. Ask for lines and test counts before and after, and every behaviour deleted on the assumption that something else covers it.

Check each report's assumed coverage against the matrix and the kept tests; add what is missing.

## 6. Verify

Run the full suite and the linters, fix what they report, measure the test lines and count before and after against the base, and commit with the coverage reasoning in the message.

Done when the suite and linters are green and the numbers are in the commit message.
