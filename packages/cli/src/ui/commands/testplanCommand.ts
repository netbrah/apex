/**
 * @license
 * Copyright 2025 Qwen Code
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SlashCommand } from './types.js';
import { CommandKind } from './types.js';

const TESTPLAN_INSTRUCTIONS = `# ONTAP Functional Test Plan

Produce a QA-executable functional test plan by tracing code changes to real CLI/REST commands, then turning those commands into step-by-step validation with expected results.

## Inputs

Include these in the prompt when available:
- \`Ticket: CONTAP-123456\`
- \`Reviewboard: 901199\`

## Workflow

### 1. Confirm Readiness

- Verify implementation and unit/regression tests are already complete.
- Treat this as a post-processing deliverable only.

### 2. Capture Change Intent

- If a Jira ticket is provided, use \`get_jira_issue\` to capture the problem statement, expected behavior, and prerequisite setup.
- If a ReviewBoard diff is provided, use \`mcp__reviewboard__get_review_request\` and \`mcp__reviewboard__get_diff_files\` (or \`mcp__reviewboard__get_revision_summary\`) to list changed files.
- From the changed files, identify touched functions, iterators, and schemas using \`analyze_symbol_ast\` and \`analyze_iterator\`.
- Extract bootargs, FIJI faults, and trace messages from the touched code paths using \`search\`.

### 3. Trace to CLI/REST Workflows

Run these in parallel when inputs are available:
- Use \`analyze_iterator\` on every iterator touched to capture fields, enums, prerequisites, and \`_imp\` methods.
- Use \`find_cits\` on the top-level CLI commands that surface from tracing to find existing coverage.
- Use \`trace_call_chain\` on touched functions to find root-level callers and CLI triggers.
- If \`smf_cli_mapping\` is available in the environment, prefer it for iterator->CLI mapping.

Then follow up:
- If \`swagger_rest_mapping\` is available, run it on discovered CLI commands to capture REST endpoints and curl examples.
- Use \`search\` and \`read_file\` to read help XML for each CLI command and message_catalogs for error strings.

### 4. Write the Plan

Use the template below and fill it with grounded data only.

## Plan Template

## Functional Test Plan: <brief description of change>

### Changed Code Summary
- Files modified, iterators affected, *_imp methods changed

### Prerequisites / Setup
- Exact CLI commands to set up the test environment
- Certificates, key servers, vservers, volumes, etc. needed
- Bootargs to set (if any discovered in the code)

### Primary Validation (happy path)
- Step-by-step CLI commands copied from help XML examples
- Expected output for each command
- What to verify in logs (trace messages found in the code)

### Negative / Error Path Tests
- Invalid inputs, missing prerequisites, unavailable services
- Expected error messages (from message_catalogs)
- FIJI fault injection points (if found in the code)

### REST API Equivalents (if applicable)
- curl commands from swagger_rest_mapping results
- Expected response codes and bodies

### Regression Checks
- Existing functionality that must still work after the change
- Related commands that share the same iterator/table

### Cluster / HA / MetroCluster (if applicable)
- Multi-node scenarios, failover, takeover/giveback

### Bootarg Test Matrix (if bootargs found in code)
- Test with bootarg enabled vs disabled
- Expected behavior difference for each

### Related CITs
- Existing CITs from find_cits that cover this area
- Which CITs should be re-run to validate the fix

## Rules

- Source every CLI command from help XML or mastra-search results. Do not invent syntax.
- Source every expected error message from message_catalogs.
- Match every parameter to the .smf schema field definitions exactly.
- Enumerate enum values from their type .smf definitions.`;

export const testplanCommand: SlashCommand = {
  name: 'testplan',
  altNames: ['tp'],
  description:
    'Generate a functional test plan for a CONTAP or ReviewBoard diff',
  kind: CommandKind.BUILT_IN,
  action: (_context, args) => {
    if (!args.trim()) {
      return {
        type: 'message' as const,
        messageType: 'error' as const,
        content:
          'Usage: /testplan CONTAP-XXXXXX or /testplan Reviewboard: 901199',
      };
    }
    return {
      type: 'submit_prompt' as const,
      content: [
        {
          text: `${TESTPLAN_INSTRUCTIONS}\n\nGenerate functional test plan for: ${args.trim()}`,
        },
      ],
    };
  },
};
