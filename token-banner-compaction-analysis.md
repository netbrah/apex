# Token Banner, Context Window Display & Compaction Visibility Analysis

**Date:** 2026-03-24  
**Scope:** Analysis only — no code changes

---

## 1. Token / Context Window Display — Current Implementation

### 1.1 Footer Bar (Always Visible)

| File                                                        | Purpose                                                                                                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/cli/src/ui/components/Footer.tsx`                 | Main footer — reads `lastPromptTokenCount` from session stats and `contextWindowSize` from config, conditionally renders `<ContextUsageDisplay>`                          |
| `packages/cli/src/ui/components/agent-view/AgentFooter.tsx` | Agent-tab footer — same pattern, receives props from `AgentComposer.tsx`                                                                                                  |
| `packages/cli/src/ui/components/ContextUsageDisplay.tsx`    | Inline display: calculates `percentage = promptTokenCount / contextWindowSize`, formats as `"32.5K/1.0M tokens (3.2% context used)"` or compact form for narrow terminals |

**Visibility:** Only shown when `promptTokenCount > 0 && contextWindowSize` is truthy — i.e., after the first API response.

### 1.2 `/context` Command (On-Demand Detailed View)

| File                                                    | Purpose                                                                                                                                              |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/cli/src/ui/commands/contextCommand.ts`        | Computes a full breakdown: system prompt, built-in tools, MCP tools, memory files, skills, messages, autocompact buffer, free space                  |
| `packages/cli/src/ui/components/views/ContextUsage.tsx` | Renders bordered box with a 3-segment progress bar (used ▓ / autocompact buffer ▒ / free ░), color-coded (accent < 60%, warning 60-80%, error > 80%) |

**Key detail:** The autocompact buffer is calculated as `(1 - compressionThreshold) * contextWindowSize` — this is the reserved space that, once consumed, triggers automatic compression.

### 1.3 `/stats` Command

| File                                                   | Purpose                                                                                 |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `packages/cli/src/ui/commands/statsCommand.ts`         | Dispatches to StatsDisplay, ModelStatsDisplay, or ToolStatsDisplay                      |
| `packages/cli/src/ui/components/StatsDisplay.tsx`      | Per-model table: requests, input tokens, output tokens, cache efficiency                |
| `packages/cli/src/ui/components/ModelStatsDisplay.tsx` | "Model Stats For Nerds": total, prompt, cached, thoughts, tool, output tokens per model |

### 1.4 Loading Indicator (Streaming)

**File:** `packages/cli/src/ui/components/LoadingIndicator.tsx`  
During streaming, shows output token count: `"Thinking... (12s · ↓ 1.2k tokens · esc to cancel)"`

### 1.5 Session Summary (On Exit)

**File:** `packages/cli/src/ui/components/SessionSummaryDisplay.tsx`  
Renders `<StatsDisplay>` on `/quit` with "Agent powering down. Goodbye!"

---

## 2. Compaction (History Compression) — Current Implementation

### 2.1 Two Trigger Paths

#### Manual: `/compress` command

- **File:** `packages/cli/src/ui/commands/compressCommand.ts`
- Calls `geminiClient.tryCompressChat(promptId, true)` with `force=true`
- Shows a spinner (`<CompressionMessage isPending={true}>`) during compression
- Shows result: `"Chat history compressed from X to Y tokens."`

#### Automatic: Before every turn

- **File:** `packages/core/src/core/client.ts` (line ~547)
- Called at the **start of every `executePrompt()` call**, before the model generates:
  ```ts
  const compressed = await this.tryCompressChat(prompt_id, false);
  if (compressed.compressionStatus === CompressionStatus.COMPRESSED) {
    yield { type: GeminiEventType.ChatCompressed, value: compressed };
  }
  ```
- `force=false` — only compresses if threshold is exceeded

### 2.2 Threshold Logic

**File:** `packages/core/src/services/chatCompressionService.ts`

| Constant                                | Value       | Meaning                                                           |
| --------------------------------------- | ----------- | ----------------------------------------------------------------- |
| `COMPRESSION_TOKEN_THRESHOLD`           | `0.7` (70%) | Standard APIs — compress when token count ≥ 70% of context window |
| `RESPONSES_COMPRESSION_TOKEN_THRESHOLD` | `0.9` (90%) | OpenAI Responses API — compress when ≥ 90%                        |
| `COMPRESSION_PRESERVE_THRESHOLD`        | `0.3` (30%) | Keep the last 30% of history, compress the first 70%              |

**Configurable:** `config.getChatCompression()?.contextPercentageThreshold` overrides the defaults.

**Decision flow:**

1. If history is empty, or threshold ≤ 0, or a previous compression already failed → NOOP
2. If not forced: `originalTokenCount < threshold * contextWindowSize` → NOOP
3. Otherwise → compress (fire `PreCompact` hook, then summarize via LLM or Responses API)

### 2.3 Compression Methods

1. **LLM-based summarization** (default): Sends the oldest 70% of history to the model with a compression prompt, gets a summary, replaces the old history with `[summary, "Got it. Thanks!", ...kept_history]`
2. **Responses API compaction** (`ResponsesCompactionClient`): For OpenAI Responses API auth — uses server-side compaction

### 2.4 Failure Handling

| Status                                    | Behavior                                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| `COMPRESSED`                              | Success — updates chat history, resets pipeline state                                        |
| `COMPRESSION_FAILED_INFLATED_TOKEN_COUNT` | Summary was larger than original — sets `hasFailedCompressionAttempt=true`, won't auto-retry |
| `COMPRESSION_FAILED_EMPTY_SUMMARY`        | Model returned empty summary — sets `hasFailedCompressionAttempt=true`                       |
| `COMPRESSION_FAILED_TOKEN_COUNT_ERROR`    | Couldn't calculate new token count — no retry                                                |
| `NOOP`                                    | Nothing to compress or under threshold                                                       |

**Important:** After a failed auto-compression, `hasFailedCompressionAttempt = true` prevents further auto-attempts for the session. Only a forced `/compress` can retry.

---

## 3. Compaction Visibility Gaps — What You Currently Cannot See

### 3.1 ❌ No Pre-Compaction Warning

There is **no proactive notification** when the context window is approaching the compression threshold. The user only discovers compression happened **after the fact**. The footer shows the current percentage, but there's no warning like "⚠️ Context at 65%, auto-compress at 70%."

### 3.2 ❌ Auto-Compression Shows Only a Text Info Message (No Spinner, No Banner)

When auto-compression fires (in `useGeminiStream.ts`, line ~885), the UI emits a plain `type: 'info'` text message:

```
IMPORTANT: This conversation approached the input token limit for <model>.
A compressed context will be sent for future messages (compressed from: X to Y tokens).
```

**Contrast with `/compress`:** The manual command shows a dedicated `<CompressionMessage>` component with a spinner while pending and styled success text. Auto-compression uses a generic info message — no spinner during the compression, and it happens **before** the model response starts streaming, so the user sees a delay with no explanation.

### 3.3 ❌ No Visual Indicator DURING Auto-Compression

Auto-compression can take several seconds (it makes an LLM call to summarize). During this time:

- The loading indicator hasn't started yet (compression happens before `executePrompt` yields streaming events)
- No spinner or status text explains the pause
- The user sees a frozen UI after pressing Enter — it looks like a hang

### 3.4 ❌ No Distinction Between "Thinking" and "Compressing"

The `LoadingIndicator` component shows "Thinking..." once the model starts streaming. But the compression delay occurs **before** streaming begins. There's no state like "Compressing..." visible in the loading indicator.

### 3.5 ❌ No Footer/Banner Update During Compression

The footer's `ContextUsageDisplay` updates based on `lastPromptTokenCount` from telemetry. This value updates **after** compression succeeds (via `uiTelemetryService.setLastPromptTokenCount(newTokenCount)`). There's no intermediate state showing "compressing..." in the footer.

### 3.6 ❌ Compression Failure is Silent for Auto-Compression

If auto-compression fails (inflated, empty summary, token error):

- `hasFailedCompressionAttempt` is set to `true` silently
- No `ChatCompressed` event is yielded (only yielded on success)
- The user is never told that compression was attempted and failed
- Future auto-compressions are silently disabled for the session
- The only way to discover this is running `/stats` or `/context` and noticing the high usage

### 3.7 ❌ No Indication That Auto-Compression is Disabled After Failure

Once `hasFailedCompressionAttempt = true`, the system will never auto-compress again in that session. There's no UI state reflecting this — the user doesn't know they need to manually `/compress` (with force) or start a new session.

### 3.8 ❌ `/context` Shows Buffer but Not Compression State

The `/context` command shows the autocompact buffer size, but:

- Doesn't show whether auto-compression is currently enabled or disabled
- Doesn't show if a compression has previously failed
- Doesn't show the compression threshold percentage
- Doesn't show how close you are to triggering auto-compression (only total usage %)

---

## 4. Summary of Current Visibility

| Event                                   | Visibility                                          | UX Quality |
| --------------------------------------- | --------------------------------------------------- | ---------- |
| Current token count                     | ✅ Footer bar (always visible after first response) | Good       |
| Context window breakdown                | ✅ `/context` command                               | Good       |
| Token stats per model                   | ✅ `/stats` command                                 | Good       |
| Manual `/compress` in progress          | ✅ Spinner + styled message                         | Good       |
| Manual `/compress` result               | ✅ "Compressed from X to Y tokens"                  | Good       |
| Auto-compression result                 | ⚠️ Plain info message (easy to miss)                | Poor       |
| Auto-compression in progress            | ❌ No indicator — UI appears frozen                 | Bad        |
| Approaching threshold warning           | ❌ None                                             | Missing    |
| Auto-compression failure                | ❌ Silent — no user notification                    | Bad        |
| Auto-compression disabled after failure | ❌ No indication anywhere                           | Bad        |
| Compression threshold value             | ❌ Not shown in UI                                  | Missing    |
| Output tokens during streaming          | ✅ Loading indicator                                | Good       |

---

## 5. Key Files Reference

| Area                         | File                                                                       |
| ---------------------------- | -------------------------------------------------------------------------- |
| Compression service          | `packages/core/src/services/chatCompressionService.ts`                     |
| Client auto-compress trigger | `packages/core/src/core/client.ts` (lines 547-550)                         |
| `/compress` command          | `packages/cli/src/ui/commands/compressCommand.ts`                          |
| Auto-compress UI handler     | `packages/cli/src/ui/hooks/useGeminiStream.ts` (lines 883-904, 1011-1012)  |
| Compression display          | `packages/cli/src/ui/components/messages/CompressionMessage.tsx`           |
| Footer context display       | `packages/cli/src/ui/components/ContextUsageDisplay.tsx`                   |
| Context usage view           | `packages/cli/src/ui/components/views/ContextUsage.tsx`                    |
| Context command              | `packages/cli/src/ui/commands/contextCommand.ts`                           |
| Token limits DB              | `packages/core/src/core/tokenLimits.ts`                                    |
| UI telemetry service         | `packages/core/src/telemetry/uiTelemetry.ts`                               |
| Config types                 | `packages/core/src/config/config.ts` (line 209: `ChatCompressionSettings`) |
