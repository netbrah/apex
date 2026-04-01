/**
 * @license
 * Copyright 2025 Apex
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SlashCommand } from './types.js';
import { CommandKind } from './types.js';

const RCA_INSTRUCTIONS = `# Root Cause Analysis

Investigate CIT failures by tracing actual runtime evidence (logs) back to source code. Every hypothesis must be grounded in BOTH a log line AND a code reference.

## Core Rule

**A hypothesis validated only by the same source that generated it is not validated.**

- Code-only hypothesis? → MUST validate against logs before accepting.
- Log-only interpretation? → MUST cross-reference the source code that emitted it.

## Phase 1: Parse the Ticket

Extract from the JIRA ticket text (not just the URL):

1. **Log paths** — Tickets often paste filesystem paths directly. Look for patterns like:
   - \`/u/<user>,<cluster>/presub/logs*/.../<node>/mroot/etc/log/mlog/mgwd.log*\`
   - \`/u/<user>/presub/logs/...\`
   - Prefer paths that appear in the ticket body over URL-derived paths.

2. **CIT URL** — As fallback, convert URL to filesystem path.

3. **Node names** — Source vs destination, panicked node, partner node.

4. **Timestamps** — First failure time, panic time, giveback time, any times quoted in the ticket.

5. **Filer's hypothesis** — Note it but do NOT adopt it. Treat it as one lead among many.

6. **Error strings** — Exact error messages, KMIP status codes, smdb_error values.

## Phase 1.5: Mine Jira Intelligence

**Run BOTH tools in parallel** — they serve different purposes:

\`\`\`
# In parallel:
get_jira_issue(issue_key="JIRA-XXXXXX")   # raw structured data
\`\`\`

\`get_jira_issue\` returns the full raw ticket (description + all comments as structured JSON).

### Handling Large Responses

\`get_jira_issue\` often returns 50-100KB for active defects. When the raw response is too large to read in one pass:
- Extract comments with: \`jq '.fields.comment.comments[] | {author: .author.displayName, created: .created, body: .body}' < jira_response.json\`
- **NEVER abandon the Jira data track** because the response was large. That's where the gold is.

### Related Issues

Use \`search_jira\` with a JQL query to find related defects by component, error signature, or CIT name. Related tickets often reveal known patterns, regressions, or prior fixes.

### Precedent Search

After identifying the root cause mechanism, search Jira for prior tickets with the same bug class. Use function/API names for best precision:
\`\`\`
search_jira(text="<function_or_api_name>", project="JIRA", limit=5)
\`\`\`
Prior fixes in the same bug class provide:
- Proven fix patterns (what approach worked before)
- Blast radius hints (what else was affected last time)
- Reviewer expectations (who reviewed the prior fix)

### Why This Matters

Engineers paste log snippets, stack traces, and analysis into Jira comments **while logs are still live on NFS**. By the time you investigate, those NFS logs may have aged out (CIT log retention is ~30 days). The Jira comments are the permanent record of what engineers saw in the live logs. **Always read ALL Jira comments before forming a hypothesis.**

## Phase 2: Discover the Log Tree

Validate that log paths exist. CIT log trees vary:

\`\`\`bash
# List the testInfo directory to find node names
ls <cit-path>/*testInfo/

# Each node has two log roots — check both
ls <cit-path>/*testInfo/<node>/mroot/etc/log/mlog/  # management root
ls <cit-path>/*testInfo/<node>/droot/etc/log/mlog/  # data root (sometimes different)

# Rotated logs exist as mgwd.log.0000000001, .0000000002, etc.
ls <cit-path>/*testInfo/<node>/mroot/etc/log/mlog/mgwd.log*
\`\`\`

## Phase 3: Orient — Find the Boundaries

Before deep-diving, establish the timeline window:

\`\`\`bash
# Find the first occurrence of the failure/error
grep -n '<error_string>' <mgwd.log> | head -5

# Get timestamp of first failure
sed -n '<line_number>p' <mgwd.log>

# Look 10-15 minutes BEFORE the first failure for setup context
grep -n 'panic\\|giveback\\|takeover\\|rebaseline\\|ASSERT\\|coredump\\|restart' <mgwd.log> | head -20

# Find PID changes (process restarts)
grep -n 'seq 0x0001 ' <mgwd.log>  # seq resets indicate process restart
\`\`\`

**Critical**: The root cause almost always precedes the first visible error by minutes. If you only look at the failure line, you will miss it.

## Phase 4: Two-Track Investigation

Run both tracks. Neither alone is sufficient.

### Track A: Log Evidence

Grep for relevant patterns in mgwd.log, kmip2_client.log, and other logs. Build a chronological timeline of events with exact timestamps, sequence numbers, and line numbers.

What to look for:
- State changes (enable, disable, restore, rebaseline, partition create/delete)
- Error messages and their immediate context (5-10 lines before and after)
- Success messages that SHOULD have worked but didn't
- PID/sequence number discontinuities (indicate restarts)
- Field values in log messages (vserver IDs, key IDs, partition names, config paths)

### Track B: Code Cross-Reference

For every significant log line, find the source code that produced it:

\`\`\`
search(full="<unique_substring_from_log>", maxResults=20)
analyze_symbol_ast(symbol="<function_name>")
read_file(file_path="<absolute-path-to-file>", offset=X, limit=Y)
\`\`\`

For each log line → code match, answer:
- What condition triggered this log message?
- What was the function trying to do?
- What happens AFTER this log line in the code path — does it return error, continue, retry?
- Does the log message accurately reflect the outcome?

### Positive Proof Requirement

When claiming a function call or API usage is ABSENT from a code path:
1. List every directory/path explicitly searched
2. Search for variant spellings
3. Search at least one RELATED subsystem where the pattern SHOULD exist

A positive proof in a sibling subsystem upgrades the hypothesis from "plausible" to "grounded."

### Cross-Validation Checkpoints

After forming a hypothesis, STOP and verify:

| If your hypothesis came from... | Validate with... |
|---|---|
| Code reading (e.g., "this function has a bug") | Find the log line that proves this code path was actually hit at runtime |
| Log interpretation (e.g., "restore failed") | Find the source code and confirm what "failed" actually means |
| Absence of evidence (e.g., "X never happened") | Confirm the log level is enabled, the code path would have logged, and you searched the right log file and time window |

## Phase 5: Anti-Hallucination Patterns

Common traps:

1. **"Restore succeeded" doesn't mean recovery worked** — The function may return Ok without validating that the restored state is actually usable. Check what happens AFTER restore returns.

2. **DuplicateKey / KeyNotFound at the SMF layer ≠ actual runtime error** — These are code-level possibilities. Check the log for which error ACTUALLY occurred.

3. **\`update(op_create)\` semantics** — Code analysis may reveal create-first vs modify-first patterns, but the actual failure mode depends on whether the row exists at runtime.

4. **Process restarts invalidate in-memory state** — After a panic/restart, on-disk config may be correct but the running process hasn't loaded it.

5. **"Function X calls function Y" doesn't mean Y was called in THIS execution** — Conditional paths, early returns, and error short-circuits mean the call graph is a superset of any single execution.

## Phase 5.5: Blast Radius & Consumer Impact (if applicable)

**Purpose:** After identifying the root cause, determine WHO ELSE is affected — which workloads, subsystems, or features exercise the same code path.

**HARD RULE: Zero hallucination tolerance.** Every consumer listed MUST come from tool results, never from reasoning alone.

### When to Run This Phase

Run this phase ONLY when:
- The root cause is a code-level defect (not a config error, test infra issue, or environment problem)
- The affected function has callers beyond the immediate failure path
- The fix could have side effects on other consumers

Skip this phase when:
- The root cause is test infrastructure, environment, or configuration
- The affected code is single-purpose (one caller, one use case)

### HARD RULE — Tiered Tool Chain (MANDATORY ESCALATION ORDER)

**You MUST start at Tier 1. You MUST NOT skip tiers.**

\`\`\`
MANDATORY FLOW:

  Tier 1: analyze_symbol_ast       <- ALWAYS START HERE
       |
       +-- 1-2 callers, same subsystem? --> STOP. Report. Done.
       |
       +-- Callers are wrappers? --> Run Tier 1 AGAIN on the wrapper.
       |
       +-- Multiple callers / cross-subsystem? --> Tier 2
                |
                +-- Clear entry points found? --> STOP. Report. Done.
                |
                +-- Iterator involved? --> analyze_iterator (special case)
                |
                +-- Need CLI/REST/tables? --> Tier 3
                         |
                         +-- STOP. Report. Done.
\`\`\`

#### Tier 1: \`analyze_symbol_ast\` — ALWAYS FIRST (~300ms, ~1K tokens)

**Decision point — STOP if:** Only 1-2 callers in same subsystem, only test callers, or function is static/file-local.
**Escalate to Tier 2 ONLY if:** Multiple callers across different subsystems.

#### Tier 2: \`call_graph_fast\` — ONLY after Tier 1 proves insufficient (~1-5s, ~3K tokens)

**Decision point — STOP if:** All callers traced to clear entry points (CLI handlers, task handlers, \`*_imp\` methods).
**Escalate to Tier 3 ONLY if:** Need CLI commands / REST endpoints / SMF tables that Tier 2 didn't provide.

#### Tier 3: \`trace_call_chain\` — ONLY after Tier 2 proves insufficient (~5-30s, ~5K tokens)

Has a 30-second hard budget. Returns downstream tables, upstream CLI triggers, parameter flows.

#### Special Case: Iterator — \`analyze_iterator\` (branch from Tier 2)

If affected code is an iterator \`*_imp\` method or involves an SMF table, use this instead of Tier 3.

### Classifying Consumers from Tool Results

Classify each caller by its **file path** — this is the only reliable signal:

| File path pattern | Workload type |
|---|---|
| \`replication/\`, \`snapmirror/\`, \`repl_\` | Replication / SnapMirror |
| \`flexgroup/\`, \`fg_\` | FlexGroup |
| \`csm/\`, \`ct_lo_socket\`, \`btls/\` | CSM / cluster interconnect (remote) |
| \`wafl/\`, \`waffi_\` | Local WAFL I/O |
| \`ktls/\`, \`tls_\` | kTLS offload |
| \`nfs/\`, \`cifs/\`, \`s3/\` | Protocol layer (NFS/CIFS/S3) |
| \`iscsi/\`, \`nvmf/\`, \`fcp/\` | Block protocols |

**Do NOT classify by function name guessing.**

### Confidence Tiers

| Tier | Criteria | Action in Report |
|------|----------|-----------------|
| **GROUNDED** (include) | Consumer found by \`analyze_symbol_ast\` or \`call_graph_fast\` with file:line evidence | List in "Blast Radius" section with full citations |
| **PLAUSIBLE** (flag with warning) | Indirect relationship (depth 3+) or cross-subsystem you cannot fully trace | List in "Possible Additional Impact (unverified)" subsection with WARNING |
| **SPECULATIVE** (omit entirely) | No tool found this. You are inferring from naming or general knowledge. | **DO NOT INCLUDE.** |

### Anti-Hallucination Checks for This Phase

- Every consumer listed has a \`file:line\` reference from a tool result
- No consumer was added based on "I think X probably calls this"
- Workload classifications are based on file paths, not guesses
- If zero grounded consumers beyond immediate failure path, say so explicitly
- Tiered tool chain was followed in order

## Phase 6: Output

Present your analysis in the following format:

# <TICKET-ID> RCA: <Short Title>

## Scope / Constraints
<Any exclusions, scope limitations>

## Summary
1-2 sentences. Root cause + impact. Manager-forwardable.

## Scenario
- **Environment:** <version, topology>
- **Action:** <trigger>
- **Result:** <symptom>

## Timeline
| Time | Event | Log Evidence | Code Reference |
|------|-------|-------------|----------------|
| HH:MM:SS | What happened | <log_file>:<line> — exact message | <source_file>:<line> — function |

## Claim-Evidence Matrix
| Claim ID | Claim | Log Evidence | Code Evidence | Confidence |
|----------|-------|--------------|---------------|------------|
| C1 | | <log>:<line> | <src>:<line> | High/Med/Low |

## Root Cause
### The Defect
<Technical description with inline code. Reference Claim IDs.>

### Positive Proof
<Same pattern in sibling subsystem. File:line. Or "not found — searched: ...">

### Why This Was Latent ("Why Now?")
At least two evidence-backed reasons:
- Reason 1: <evidence>
- Reason 2: <evidence>

### Precedent
<Prior tickets with same bug class, or "Searched: <query>, none found.">

## Disconfirmed Hypotheses
| Hypothesis | Why Plausible | Why Rejected | Evidence |
|------------|---------------|--------------|----------|
| H1 | | | <file:line> |

## Blast Radius
### Confirmed Impact
<From tool results only — analyze_symbol_ast / call_graph_fast callers.>
### Possible Additional Impact (Unverified)
> Plausible but not verified. Do not treat as confirmed.

## Fix Recommendation
Concrete: which function, what change, exact insertable code, why it addresses the root cause.

## Search Scope Declaration
For every "X is not called / not present" claim:
| Claim | Pattern | Tools Used | Directories Searched | Result |
|-------|---------|------------|---------------------|--------|

## Operational Handoff
- **Reproduction CLI:** <exact command>
- **Error signature (present before fix):** <code/string>
- **Error signature (absent after fix):** <same — should be ABSENT>
- **Validation log:** <which daemon log>
- **Validation port/trace:** <if applicable>
- **Precedent fix:** <file:line in sibling subsystem>

## Evidence Appendix
Full grep commands used, log excerpts, and code snippets. Reproducible by anyone with log access.

### RCA Submission Gate
Before publishing, verify:
- Every root-cause claim appears in claim-evidence matrix
- Every "not found / zero results" claim has search scope declaration
- At least one disconfirmed hypothesis documented (or explicit N/A)
- No speculative blast-radius claim labeled as confirmed
- Operational handoff block is populated
- "Why now?" section has at least two evidence-backed reasons

## Historical Changeset Lookup (P4)

Some JIRA tickets reference P4 changelists that predate the git migration. When a ticket mentions a CL number (e.g., \`CL 12345678\` or \`@=12345678\`), use \`p4 describe\` to retrieve the changeset context.

\`\`\`bash
p4 describe -s <changelist_number>
\`\`\`

Returns: author, date, description, and list of affected files with action (add/edit/delete). Use this to understand what the original change did when correlating with a current defect.

**When to use:** Only when the ticket explicitly references a P4 changelist number. Do not speculatively search P4 history.

**Limitations:** P4 client must be configured. If \`p4 describe\` fails, note the CL number in the RCA report as "P4 context unavailable" and proceed with available evidence.

## CIT Log Navigation Reference

### URL to Filesystem Path Conversion

JIRA tickets include CIT log URLs in two formats:

**Format 1: natejobs.cgi (older)**
\`http://web.<cluster>.gdl.englab.netapp.com/natejobs.cgi?testbed=/u/<user>/presub;logdir=<cit-run-name>\`
Note: semicolon separator (not &).

**Format 2: natejobs_gx.cgi (newer)**
\`http://web.<cluster>.gdl.englab.netapp.com/natejobs_gx.cgi?testbed=/u/<user>/presub&logdir=<cit-run-name>\`

**Conversion Steps:**
1. Extract cluster from hostname: \`web.rtpsmoke.gdl...\` -> \`rtpsmoke\`
2. Extract user from testbed param: \`/u/smoke/presub\` -> \`smoke\`
3. Extract cit-run-name from logdir param
4. Build path: \`/u/<user>,<cluster>/presub/logs/<cit-run-name>/\`

**Key gotcha**: The comma in \`/u/smoke,rtpsmoke/\` is a literal comma — it is NOT \`/u/smoke/rtpsmoke/\`.

### Log Path Variants

CIT logs may live under different logs* directories:
- \`/u/<user>,<cluster>/presub/logs/<cit-run-name>/\` (standard)
- \`/u/<user>,<cluster>/presub/logs_26_06a/<run-id>/<cit-run-name>/\` (archive variant)

If the standard path doesn't exist, try:
\`find /u/<user>,<cluster>/presub/ -maxdepth 3 -name "<cit-run-name>" -type d 2>/dev/null\`

### Inside the CIT Directory

\`\`\`
<cit-path>/
  010_test/                           # test execution logs
    001_<test-name>/                  # test case directory
  <timestamp>.testInfo/               # per-node system logs (THE GOLD)
    <node-1>/
      mroot/etc/log/mlog/            # management root logs
      droot/etc/log/mlog/            # data root logs
    <node-2>/
      mroot/etc/log/mlog/
      droot/etc/log/mlog/
\`\`\`

### Log File Inventory

| File | Content | When to Read |
|------|---------|-------------|
| \`mgwd.log\` | Management daemon — SMF operations, iterator calls, service handlers, CLI processing | Always — primary investigation target |
| \`mgwd.log.0000000001\` | Rotated mgwd log (older entries) | When failure happened early or after restart |
| \`kmip2_client.log\` | KMIP client — GET, Register, Create operations, server responses | Key retrieval failures, CRYPTOGRAPHIC_FAILURE, timeout |
| \`application.log\` | Embedded KMIP server — partition ops, key storage, encryption | Partition locking, PDEK issues, server-side errors |
| \`notifyd.log\` | Notification daemon — EMS events | EMS-level alerts |
| \`sktrace.log\` | Security key trace — key lifecycle events | Key creation, deletion, rotation tracing |

### Grep Recipes

**Keymanager / eKMIP Investigation:**
\`\`\`bash
grep -n 'SvmMigrate\\|postCutover\\|preCutover\\|applySvmKek\\|applyPdek\\|pushKey' <mgwd.log>
grep -n 'restore\\|Restore\\|epk_read_local\\|rebaseline' <mgwd.log>
grep -n 'partition\\|updateVserver\\|CryptsoftServerConfig' <mgwd.log>
grep -n 'CRYPTOGRAPHIC_FAILURE\\|ITEM_NOT_FOUND\\|PERMISSION_DENIED\\|ResultStatus' <kmip2_client.log>
grep -n 'kmipGet\\|kmipRegister\\|kmip_keytable_v2' <mgwd.log>
grep -n 'PDEK\\|SVM-KEK\\|svm_kek\\|wrapped_pdek\\|pdek_id' <mgwd.log>
\`\`\`

**Panic / Restart Investigation:**
\`\`\`bash
grep -n 'panic\\|coredump\\|ASSERT\\|abort\\|giveback\\|takeover' <mgwd.log>
grep -n 'seq 0x0001 ' <mgwd.log>
grep -n 'starting\\|stopping\\|initialized\\|shutdown' <mgwd.log>
\`\`\`

**General Error Hunting:**
\`\`\`bash
grep -n 'traceError\\|Error\\|FAILED\\|failed\\|error' <mgwd.log> | head -50
grep -n 'DuplicateKey\\|KeyNotFound\\|InvalidField\\|InvalidOperation\\|AppError' <mgwd.log>
grep -n 'rdb_callback\\|rdb.*failed\\|rdb.*error' <mgwd.log>
\`\`\`

**Context Around a Line:**
\`\`\`bash
sed -n '<start>,<end>p' <mgwd.log>
awk 'NR>=49990 && NR<=50010' <mgwd.log>
\`\`\`

### NATE Test Step Logs

The 010_test/ subtree contains NATE test execution logs that show:
- Which CLI commands the test ran and in what order
- The test's assertion results (PASS/FAIL)
- The test's own timeline (useful for correlating with mgwd.log timestamps)

\`find <cit-path>/010_test/ -name "*.log" | grep -i '<test_keyword>'\``;

export const rcaCommand: SlashCommand = {
  name: 'rca',
  description: 'Investigate a JIRA ticket or CIT failure',
  kind: CommandKind.BUILT_IN,
  action: (_context, args) => {
    if (!args.trim()) {
      return {
        type: 'message' as const,
        messageType: 'error' as const,
        content: 'Usage: /rca JIRA-XXXXXX or /rca <CIT URL>',
      };
    }
    return {
      type: 'submit_prompt' as const,
      content: [{ text: `${RCA_INSTRUCTIONS}\n\nInvestigate: ${args.trim()}` }],
    };
  },
};
