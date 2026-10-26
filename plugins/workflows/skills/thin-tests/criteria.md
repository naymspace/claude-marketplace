# Test verdicts

Every test gets one verdict:

- **KEEP**: it protects something no other test does.
- **CONDENSE**: its intent stays, but in fewer tests (a table, a merge into a neighbour, fewer cases).
- **DELETE**: what it checks is already protected elsewhere, or nothing at all; name where.

## Keep

- **Regression** tests: `git log -S'<test name fragment>'` and the commit that added a test show whether it arrived with a bug fix. A test born with a fix is KEEP unless it is literally duplicated.
- Security: authorization, isolation between users or tenants, revoked or forged credentials, data that must never leak (secrets, private fields).
- Entity-specific logic: custom queries or transformations, computed values, time zone and calendar edges, aggregation and rounding rules, values checked against the domain's source of truth.
- Business rules asserted with absolute expected values.
- Registry-wide generated tests and tests that run every documented example.

## Delete

- **Restatement**: the test repeats a declaration (a permission line, a field list, an object's default attributes such as struct fields, a config value) instead of behaviour.
- Checks of definitions that are already validated at build or load time (compiler, type checker, schema validation at startup, an Elixir module attribute built with a raising constructor); keep at most one table of the validator's rejections for future authors.
- **Tautology**: the code under test calls the function the test compares against, or a refactor made two compared paths one.
- **Vacuous** assertion: it cannot fail (a subset of the whole table, a key check on an object that always has the key such as `Map.has_key?/2` on a struct, a check that passes on an empty result).
- **Spot check**: generic behaviour (denied without permission, other users' data stays hidden, input validation works) repeated per entity while a generic test or a matrix covers it.
- Smoke tests already subsumed ("returns rows", "examples run" when all examples run elsewhere).
- Tests of test tooling that only check its shape.

## Condense

- Copy-paste variants that differ in one value: one table-driven test (in ExUnit a `for` over a list of cases inside one test, or `for` around `test` with `@tag` to generate one test per case).
- A test that only adds one assertion to a neighbour's setup: merge it.
- Several tests building the same fixture for one behaviour: one test.

## Weaknesses to fix while keeping

- **Brittle**: full-string equality on messages, hard-coded lists of names that change with every addition, selecting fixtures by index. Assert stable codes or fragments, derive lists from the registry, select by content.
- Assertions that only check "some error" (any exception, any error result such as `{:error, _}`, any non-2xx status): they also pass on an unrelated failure; assert the specific error type or code, e.g. `{:error, %MyError{code: "access_denied"}}`.
- Values that cannot exercise the rule (a rounding test with exact numbers, a truncation test without remainder).

## Matrix tests

A **matrix** test iterates the registry of entities and checks one rule for each, so new entities are covered without new tests. It replaces spot checks only after it went **red** under a mutation of the rule it guards. Typical axes: permission gate per entity, ownership (own records versus others'), sensitive fields in every place they can be read or used (output, filter, sort, aggregate, search), isolation between users or tenants, input validation per endpoint.
