---
name: ontap-unit-test-plan
description: Generate a comprehensive unit test plan for a proposed ONTAP code fix. Use when you have an RCA or implementation plan and need to plan unit test coverage before implementing. Takes the fix recommendation and produces mocking strategy, coverage matrix, fixture needs, and FIJI fault handles.
---

# ONTAP Unit Test Plan

**⚡ SKILL INVOKED: ontap-unit-test-plan** — Emit this line before any other output when this skill activates.

## When to Use

- After an RCA produces a fix recommendation and you want a test plan before implementing
- When given "write unit test plan for X" where X is a function, fix, or proposed change
- Can run in the same session as an RCA (if context allows) or standalone in a fresh session

## Input

The skill expects one of:

1. **An RCA report already in context** — read the Fix Recommendation and Claim-Evidence Matrix sections
2. **A `~/.skills/contaps/<TICKET-ID>/rca-*.md` file path** — read the file to extract the fix
3. **A function name + description of the change** — when no formal RCA exists

## Phase 1: Discover Test Context

Build test context yourself using mastra-search tools. Do NOT use `prepare_unit_test_context` as a starting point — it's a final cross-check only.

### Primary: Analyze the function under test

```
analyze_symbol_ast(symbol="<function>", maxCallers=5, maxCallees=30, includeSource=true, contextLines=50, includeTests=true, maxTestCallers=10, verbose=true)
```

This gives you the function's callees (dependencies to mock), existing test callers (patterns to follow), and source code.

If the function is an iterator `_imp` method:

```
analyze_iterator(iterator="<iterator_name>", maxCallers=10, maxDepth=2, includeImpMethods=true, verbose=false)
```

### Then: Read the actual test file

Use `find_tests(source_file="<file>.cc")` to locate the `.ut` file, then read it directly. Look for:

- Existing TestSuite class and test cases
- Fixtures already registered
- Helper classes and mockers in use
- Mocking patterns the component already uses (which level?)

### Finally: Cross-check with prepare_unit_test_context

After you've built your own test plan, run this as a **sanity check** to see if you missed anything:

```
prepare_unit_test_context(functionName="<function>", maxCallees=50, findSimilar=true)
```

Compare its fixture list, FIJI faults, and similar tests against what you already found. Add anything you missed.

## Phase 2: Select Mocking Levels

For each dependency (callee) of the function under test, select the appropriate mocking level.

### Mocking Hierarchy (Least → Most Invasive)

| Level  | Mechanism                                 | When to Use                                                                        | Cost                                             |
| ------ | ----------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------ |
| **L1** | `SmfMethodReturnHelper`                   | Only need to control return status of an iterator method                           | Cheapest — no table setup                        |
| **L2** | `SmfTableHelper` / direct table insertion | Need real data in a table for the function to read                                 | Moderate — requires fixture + data setup         |
| **L3** | `SmfTableErrorHelper`                     | Need to fail a specific table operation (create/modify/delete) at a specific point | Moderate — targeted error injection              |
| **L4** | Fake iterator implementation              | The real iterator has too many dependencies or side effects                        | Expensive — write a stub class                   |
| **L5** | `Mocker<T>` (free function mock)          | Need to replace a free function's behavior entirely                                | Variable — clean but requires mocker declaration |

### Selection Rules

1. **Start at L1.** Can you test the behavior by just controlling return codes? If yes, stop.
2. **Move to L2** if the function reads field values from a table (need real data present).
3. **Move to L3** if you need to test error handling for a specific table operation.
4. **Move to L4** only if the iterator has complex setup requirements that would dominate the test.
5. **Use L5** for free functions that perform I/O, crypto, or network calls.
6. **Combine levels** when testing complex paths. Example: L2 (seed table data) + L3 (fail a subsequent modify) + L5 (mock a crypto utility).

### FIJI Fault Selection

From `prepare_unit_test_context` results, identify fault handles relevant to the fix:

- Error bypass faults (e.g., `keymanager.bypassquorumcheck`)
- Operation failure faults
- Timeout simulation faults

Use `ScopedFaultAlways` for deterministic fault injection in tests.

## Phase 3: Build Coverage Matrix

For the function under test, enumerate every path the fix touches or could affect:

```markdown
| #   | Path                          | Trigger                     | Mock Level(s) | FIJI Fault?  | Assertion                          |
| --- | ----------------------------- | --------------------------- | ------------- | ------------ | ---------------------------------- |
| 1   | Success — normal operation    | Valid input, table has data | L2            | none         | Returns OK, state changed in table |
| 2   | Success — edge case (empty)   | Valid input, table empty    | L1            | none         | Returns OK, no-op                  |
| 3   | Error — table op fails        | Valid input                 | L2 + L3       | none         | Returns error, state unchanged     |
| 4   | Error — dependency fails      | Valid input                 | L5 (mock dep) | none         | Returns error, cleanup executed    |
| 5   | Error — FIJI bypass           | Valid input                 | L1            | yes (handle) | Bypass path taken, logged          |
| 6   | Guard — pre-condition not met | Invalid input               | L1            | none         | Returns early, no side effects     |
```

### Mandatory Coverage

Every test plan MUST include:

- [ ] At least one success path
- [ ] At least one error path per external dependency (table op, free function, iterator call)
- [ ] At least one FIJI fault path (if fault handles exist for the function)
- [ ] State verification — assert the SMF table state after the operation (not just return code)
- [ ] Guard condition tests — verify early returns when pre-conditions aren't met

### Coverage for Fix-Specific Claims

Cross-reference the RCA Claim-Evidence Matrix:

- For each claim that drove the fix, there MUST be a test that exercises the fixed path
- The test should verify the **absence** of the defective behavior, not just the presence of the new behavior

## Phase 4: Produce Test Plan

Present the test plan in the following format:

```markdown
## Unit Test Plan

### Test File

- **Existing:** `<component>/ut/TestSuite.ut` (or "NEW FILE NEEDED")
- **Suite class:** `<TestSuiteName>`

### Dependencies to Mock

| Dependency            | Type                            | Mock Level | Mechanism                                    |
| --------------------- | ------------------------------- | ---------- | -------------------------------------------- |
| `<function/iterator>` | free func / iterator / table op | L1-L5      | `SmfMethodReturnHelper` / `Mocker<T>` / etc. |

### Fixtures Required

| Fixture          | Table                   | Purpose         |
| ---------------- | ----------------------- | --------------- |
| `<fixture_name>` | `<resolved_table_name>` | Seed data for X |

### FIJI Faults

| Handle           | Purpose                 | Test Case # |
| ---------------- | ----------------------- | ----------- |
| `<fault_handle>` | Bypass / fail / timeout | #5          |

### Coverage Matrix

| #   | Test Name                     | Path   | Mock Level(s) | FIJI? | Key Assertion   |
| --- | ----------------------------- | ------ | ------------- | ----- | --------------- |
| 1   | `test_<function>_success`     | normal | L2            | no    | state changed   |
| 2   | `test_<function>_table_error` | error  | L2+L3         | no    | state unchanged |
| 3   | `test_<function>_fiji_bypass` | bypass | L1            | yes   | bypass logged   |

### Similar Existing Tests (Reference)

From `prepare_unit_test_context`:

- `<TestSuite>::<testCase>` — uses same fixtures, good pattern to follow
```

### Quality Checks Before Finalizing

- [ ] Every callee that could fail has an error-path test
- [ ] Mocking levels are justified (not all L5 — use cheapest that works)
- [ ] Similar existing tests were reviewed (don't reinvent patterns)
- [ ] If fix touches iterator `_imp` method, test exercises the iterator's public API too
- [ ] State assertions check table contents, not just return codes

## References

- Read `references/smf-test-patterns.md` for detailed mocking examples and code patterns per level.
