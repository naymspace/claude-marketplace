---
name: triaged-review
description: Use when reviewing a branch, PR, or feature for release readiness and only blockers/high-priority issues matter. Spawns parallel review agents, then a triage agent validates each finding against the actual code and discards false positives, nitpicks, and follow-ups. Trigger phrases include "triaged review", "release review", "find blockers", "review for release", "what's blocking this".
---

Spawn a team of review agents to perform a detailed code review of $ARGUMENTS (if empty, review the changes in this branch). Then pass their findings to a triage agent that:

1. Validates each finding (confirms the issue is real by inspecting the referenced code, not just trusting the reviewer's claim — discard false positives, hallucinated line references, or issues that don't actually reproduce)
2. Classifies each validated issue by severity

Report only blockers and high-priority issues.

Exclude:
- Nitpicks (style, naming, minor refactors)
- Nice-to-haves (optional improvements)
- Follow-ups (anything that can be deferred post-release)

For each reported issue, include:
- Severity (Blocker / High)
- File and line reference
- Problem (what's wrong)
- Impact (why it blocks release)
- Suggested fix
