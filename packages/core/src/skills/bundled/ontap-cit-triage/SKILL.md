---
name: ontap-cit-triage
description: Investigate CIT failures using the cit MCP server tools. Use when asked about CIT status, test failures, testbed logs, PANICs, or when a CONTAP includes a CIT log URL or natejobs link. This skill uses HTTP-based tools that don't require NFS mounts.
---

# ONTAP CIT Triage

Investigate CIT failures end-to-end using the `cit` MCP server. All data is fetched over HTTP — no NFS mount needed.

## When to Use

- Someone asks "Is CIT X passing?"
- A CONTAP references a CIT failure or natejobs URL
- You need to find PANICs, asserts, or cores across a testbed
- You need daemon logs (mgwd, kmip2_client, secd) from specific nodes

## Workflow

### Step 1: Check status and get failure details

```
mcp__cit__cit_test_failures(cit_name="<short-name>", build_number=-1)
```

Returns: failed tests, log URLs, NATE results page, PANIC/core detection.

Use the short CIT name (e.g. "nfs-andu", "sec-key-migrate", "svm-mig-akv-disr").

### Step 2: Search across all nodes for the root cause

```
mcp__cit__testbed_grep(logdir="<logdir from step 1>", pattern="PANIC")
mcp__cit__testbed_grep(logdir="...", pattern="assert")
mcp__cit__testbed_grep(logdir="...", pattern="<error string from test log>")
```

This searches mgwd, console, messages, kmip2_client, secd, ems across ALL nodes in one call.

### Step 3: Pull specific daemon logs

```
mcp__cit__testbed_log(logdir="...", node="<node from step 2>", log_type="mgwd")
mcp__cit__testbed_log(logdir="...", node="...", log_type="console")
mcp__cit__testbed_log(logdir="...", node="...", log_type="kmip2_client")
```

### Step 4: Cross-reference with source code

Use `mastra-search` tools to find the code that emitted the error:

```
search(query="<error string from logs>", searchType="text")
analyze_symbol_ast(symbol="<function name from stack trace>")
```

## Available Tools

| Tool                          | Input                                                  | Returns                                                                         |
| ----------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `cit_status`                  | `cit_name`, optional `release`                         | Pass/fail, last build, health report                                            |
| `cit_test_failures`           | `cit_name`, optional `build_number` (-1 = last failed) | Failed tests with log URLs, PANICs, SmokeResults metadata                       |
| `testbed_grep`                | `logdir`, `pattern`, optional `log_types`, `nodes`     | rg-style matches across all nodes                                               |
| `testbed_info`                | `logdir`                                               | Node list, problems detected, core dumps                                        |
| `testbed_log`                 | `logdir`, `node`, `log_type`                           | Tail of the daemon log (mgwd, kmip2_client, secd, console, messages, ems, etc.) |
| `list_failing_cits`           | optional `release`, `name_filter`                      | All red CITs                                                                    |
| `compare_cit_across_releases` | `cit_base_name`                                        | Same CIT across dev/9.18.1/9.19.1                                               |
| `cit_test_log`                | `log_url`                                              | Raw test log content                                                            |
| `cit_log`                     | `cit_name`                                             | Jenkins console log                                                             |
| `cit_build_history`           | `cit_name`                                             | Recent builds                                                                   |

## Key Details

- **CIT names**: Use the short base name. "nfs-andu" auto-expands to "dev-cit-nfs-andu-results".
- **Releases**: Default is "dev". Pass `release="9.18.1"` or `release="9.19.1"` for other branches.
- **build_number=-1**: Gets the last FAILED build specifically.
- **testbed_grep**: Searches common log types by default (mgwd, console, messages, kmip2_client, secd, ems). Narrow with `log_types=["mgwd"]`.
- **Log dir**: Returned by `cit_test_failures`. Also accept natejobs URLs or NFS paths — the tools auto-resolve.
