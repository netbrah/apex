# Wire Protocol Null-Space Audit

> **Date**: 2026-04-03 **Branch**: `copilot/add-openai-anthropic-responses`
> (post-rebase from upstream gemini-cli) **Scope**: All three fork-specific
> converter wires — Anthropic `/messages`, OpenAI `/chat/completions`, OpenAI
> `/responses`

## Ground Truth Sources (upstream SDK versions)

| SDK                 | Version     | Type Definition Source                                            |
| ------------------- | ----------- | ----------------------------------------------------------------- |
| `@google/genai`     | **1.30.0**  | `node_modules/@google/genai/dist/genai.d.ts`                      |
| `@anthropic-ai/sdk` | **0.36.3**  | `node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts` |
| `openai`            | **5.11.0**  | `node_modules/openai/resources/chat/completions/completions.d.ts` |
| Responses API       | (our types) | `packages/core/src/core/openaiResponsesContentGenerator/types.ts` |

## What Is a "Null Space" Gap?

The internal format is Google `@google/genai` `Content[]` / `Part[]` (the
**lingua franca**). Every external wire must convert **to** Gemini format
(responses) and **from** Gemini format (requests). A **null-space gap** is a
field or concept that exists in one wire but gets silently dropped during
conversion — data goes in, nothing comes out.

---

## Gemini Part Type (Lingua Franca)

All converters translate to/from this internal representation:

| Part Field            | Type                                 | Description                         |
| --------------------- | ------------------------------------ | ----------------------------------- |
| `text`                | `string`                             | Plain text content                  |
| `thought`             | `boolean`                            | Marks part as reasoning/thinking    |
| `thoughtSignature`    | `string`                             | Opaque signature for thought replay |
| `functionCall`        | `{ id, name, args }`                 | Model requests tool execution       |
| `functionResponse`    | `{ id, name, response, parts[] }`    | Tool result sent back               |
| `inlineData`          | `{ mimeType, data, displayName }`    | Base64-encoded media                |
| `fileData`            | `{ mimeType, fileUri, displayName }` | URI-based media reference           |
| `executableCode`      | `{ code, language }`                 | Gemini-native code execution        |
| `codeExecutionResult` | `{ output, outcome }`                | Gemini-native code result           |
| `videoMetadata`       | `{ ... }`                            | Gemini-native video metadata        |
| `mediaResolution`     | `string`                             | Gemini-native media resolution hint |

---

## Wire 1: Anthropic `/messages`

### Converter: `AnthropicContentConverter`

### Gemini → Anthropic (Request Path)

| Gemini Part           | Anthropic Block               | Handled? | Notes                                   |
| --------------------- | ----------------------------- | -------- | --------------------------------------- |
| `text`                | `TextBlockParam`              | ✅       |                                         |
| `thought` (thinking)  | `thinking` block w/ signature | ✅       | Includes `thoughtSignature`             |
| `thought` (redacted)  | `redacted_thinking` block     | ✅       | `_redactedThinkingData` extension       |
| `functionCall`        | `tool_use` block              | ✅       | ID sanitization + dedup                 |
| `functionResponse`    | `tool_result` block           | ✅       | Extracts text + media parts, `is_error` |
| `inlineData` (image)  | `ImageBlockParam`             | ✅       | jpeg/png/gif/webp                       |
| `inlineData` (PDF)    | `DocumentBlockParam`          | ✅       | application/pdf                         |
| `inlineData` (other)  | text placeholder              | ✅       | Graceful degradation                    |
| `fileData` (image)    | `image` URL source            | ✅       | URI passthrough                         |
| `fileData` (PDF)      | `document` URL source         | ✅       | URI passthrough                         |
| `fileData` (other)    | text placeholder              | ✅       | Graceful degradation                    |
| `executableCode`      | —                             | ⬜ N/A   | Gemini-native only                      |
| `codeExecutionResult` | —                             | ⬜ N/A   | Gemini-native only                      |

### Anthropic → Gemini (Response Path)

| Anthropic Block                     | Gemini Part                           | Handled?   | Notes                         |
| ----------------------------------- | ------------------------------------- | ---------- | ----------------------------- |
| `text`                              | `{ text }`                            | ✅         |                               |
| `tool_use`                          | `{ functionCall }`                    | ✅         | id, name, input→args          |
| `thinking`                          | `{ text, thought, thoughtSignature }` | ✅         |                               |
| `redacted_thinking`                 | `{ thought, _redactedThinkingData }`  | ✅         | Extension field               |
| `stop_reason`                       | `FinishReason`                        | ✅         | 5 mappings                    |
| `usage` (input/output/cache)        | `usageMetadata`                       | ✅         |                               |
| `usage.cache_creation_input_tokens` | —                                     | 🟡 **GAP** | Not mapped to Gemini metadata |

### Anthropic → Gemini (Streaming Path)

| Anthropic Event                          | Gemini Part            | Handled? | Notes                             |
| ---------------------------------------- | ---------------------- | -------- | --------------------------------- |
| `message_start`                          | metadata capture       | ✅       | id, model, usage                  |
| `content_block_start` (text)             | —                      | ✅       | Block state init                  |
| `content_block_start` (tool_use)         | —                      | ✅       | Block state init w/ initial input |
| `content_block_start` (thinking)         | —                      | ✅       | Block state init w/ signature     |
| `content_block_delta` (text_delta)       | `{ text }`             | ✅       |                                   |
| `content_block_delta` (thinking_delta)   | `{ text, thought }`    | ✅       |                                   |
| `content_block_delta` (signature_delta)  | `{ thoughtSignature }` | ✅       |                                   |
| `content_block_delta` (input_json_delta) | accumulator            | ✅       |                                   |
| `content_block_stop` (tool_use)          | `{ functionCall }`     | ✅       |                                   |
| `message_delta`                          | finish + usage         | ✅       | Extended usage parsing            |
| `message_stop`                           | final usage            | ✅       |                                   |

### Anthropic Null-Space Summary

| Gap                                      | Severity | Impact                                     |
| ---------------------------------------- | -------- | ------------------------------------------ |
| `cache_creation_input_tokens` not mapped | Low      | Cosmetic — only affects billing visibility |

---

## Wire 2: OpenAI `/chat/completions`

### Converter: `OpenAIContentConverter`

### Gemini → OpenAI (Request Path)

| Gemini Part           | OpenAI Message Part       | Handled?   | Notes                              |
| --------------------- | ------------------------- | ---------- | ---------------------------------- |
| `text`                | `content_part_text`       | ✅         |                                    |
| `thought` (reasoning) | `reasoning_content` field | ✅         | Extended message type              |
| `functionCall`        | `tool_calls[]`            | ✅         | id, name, args→JSON                |
| `functionResponse`    | `tool` message            | ✅         | Empty results → `""` (not dropped) |
| `inlineData` (image)  | `image_url` data URI      | ✅         | With modality gating               |
| `inlineData` (PDF)    | `file.file_data`          | ✅         | With modality gating               |
| `inlineData` (audio)  | `input_audio`             | ✅         | wav/mp3 formats                    |
| `inlineData` (video)  | `video_url`               | ✅         | With modality gating               |
| `fileData` (image)    | `image_url` URI           | ✅         |                                    |
| `fileData` (PDF)      | `file.file_data` URI      | ✅         |                                    |
| `fileData` (video)    | `video_url` URI           | ✅         |                                    |
| `fileData` (audio)    | —                         | 🟡 **GAP** | No audio URI handler               |
| `executableCode`      | —                         | ⬜ N/A     | Gemini-native only                 |
| `codeExecutionResult` | —                         | ⬜ N/A     | Gemini-native only                 |

### OpenAI → Gemini (Response Path)

| OpenAI Field                                       | Gemini Part               | Handled?   | Notes                    |
| -------------------------------------------------- | ------------------------- | ---------- | ------------------------ |
| `message.content`                                  | `{ text }`                | ✅         |                          |
| `message.reasoning_content`                        | `{ text, thought }`       | ✅         |                          |
| `message.reasoning`                                | `{ text, thought }`       | ✅         | Fallback field           |
| `message.tool_calls`                               | `{ functionCall }`        | ✅         | JSON-parsed args         |
| `finish_reason`                                    | `FinishReason`            | ✅         | 5 mappings               |
| `usage.prompt_tokens`                              | `promptTokenCount`        | ✅         |                          |
| `usage.completion_tokens`                          | `candidatesTokenCount`    | ✅         |                          |
| `usage.total_tokens`                               | `totalTokenCount`         | ✅         | With estimation fallback |
| `usage.prompt_tokens_details.cached_tokens`        | `cachedContentTokenCount` | ✅         |                          |
| `usage.cached_tokens` (top-level)                  | `cachedContentTokenCount` | ✅         | Provider compat fallback |
| `usage.completion_tokens_details.reasoning_tokens` | `thoughtsTokenCount`      | ✅         |                          |
| `message.audio`                                    | —                         | 🟡 **GAP** | Audio output not mapped  |
| `message.refusal`                                  | —                         | 🟡 **GAP** | Refusal content dropped  |
| `message.annotations` (URL citations)              | —                         | 🟡 **GAP** | Citations not mapped     |

### OpenAI → Gemini (Streaming Path)

| OpenAI Chunk Field        | Gemini Part             | Handled? | Notes                                |
| ------------------------- | ----------------------- | -------- | ------------------------------------ |
| `delta.content`           | `{ text }`              | ✅       |                                      |
| `delta.reasoning_content` | `{ text, thought }`     | ✅       |                                      |
| `delta.reasoning`         | `{ text, thought }`     | ✅       | Fallback                             |
| `delta.tool_calls`        | streaming parser        | ✅       | `StreamingToolCallParser`            |
| Truncated tool JSON       | `finish_reason: length` | ✅       | `hasIncompleteToolCalls()` detection |
| `finish_reason`           | `FinishReason`          | ✅       |                                      |
| chunk `usage`             | `usageMetadata`         | ✅       | Same as non-streaming                |

### OpenAI Null-Space Summary

| Gap                               | Severity | Impact                                   |
| --------------------------------- | -------- | ---------------------------------------- |
| `fileData` audio URI not handled  | Low      | Audio URIs → `null` (inline audio works) |
| `message.audio` output not mapped | Low      | Audio generation models only             |
| `message.refusal` not mapped      | Low      | Safety refusal text lost                 |
| `message.annotations` not mapped  | Low      | URL citation metadata lost               |

---

## Wire 3: OpenAI `/responses`

### Converter: `responsesConverter.ts`

### Gemini → Responses (Request Path)

| Gemini Part                | Responses Input Item                      | Handled?   | Notes                            |
| -------------------------- | ----------------------------------------- | ---------- | -------------------------------- |
| `text`                     | `message` item                            | ✅         |                                  |
| `thought` (reasoning)      | `message` with `[Reasoning: ...]` wrapper | ✅         | Cannot replay as real reasoning  |
| `text` (compaction marker) | parsed JSON item (compaction/reasoning)   | ✅         | `COMPACTION_SUMMARY_PREFIX`      |
| `functionCall`             | `function_call` item                      | ✅         | call_id, name, arguments         |
| `functionResponse`         | `function_call_output` item               | ✅         | String serialization             |
| `inlineData` (image)       | `input_image` content part                | ✅         | data URI format                  |
| `inlineData` (non-image)   | —                                         | 🟡 **GAP** | PDF/audio/video silently dropped |
| `fileData`                 | —                                         | 🟡 **GAP** | URI-based media not mapped       |
| `executableCode`           | —                                         | ⬜ N/A     | Gemini-native only               |
| `codeExecutionResult`      | —                                         | ⬜ N/A     | Gemini-native only               |

### Responses → Gemini (Event Stream Path)

| Responses Event                             | Gemini Part               | Handled?   | Notes                               |
| ------------------------------------------- | ------------------------- | ---------- | ----------------------------------- |
| `response.created`                          | metadata                  | ✅         | responseId captured                 |
| `response.in_progress`                      | null                      | ✅         | No-op                               |
| `response.output_item.added`                | FC buffer init            | ✅         | function_call type                  |
| `response.output_text.delta`                | `{ text }`                | ✅         |                                     |
| `response.reasoning_summary_text.delta`     | `{ text, thought }`       | ✅         |                                     |
| `response.function_call_arguments.delta`    | accumulator               | ✅         |                                     |
| `response.output_item.done` (function_call) | `{ functionCall }`        | ✅         |                                     |
| `response.output_item.done` (reasoning)     | encrypted content capture | ✅         |                                     |
| `response.completed`                        | final response + usage    | ✅         |                                     |
| `response.failed`                           | error thrown              | ✅         |                                     |
| `response.incomplete`                       | `MAX_TOKENS` finish       | ✅         |                                     |
| `error`                                     | error thrown              | ✅         |                                     |
| `response.output_item.done` (other types)   | —                         | 🟡 **GAP** | Unknown item types silently ignored |

### Responses Null-Space Summary

| Gap                                        | Severity | Impact                                     |
| ------------------------------------------ | -------- | ------------------------------------------ |
| Non-image `inlineData` silently dropped    | Medium   | PDF/audio attachments lost on request path |
| `fileData` not mapped at all               | Medium   | URI-based media lost on request path       |
| Unknown output item types silently ignored | Low      | Future API additions may be lost           |

---

## Cross-Wire Summary

### ✅ Fully Covered Across All Three Wires

- Text content (plain + reasoning/thinking)
- Function calls (name, args, id)
- Function responses (text content extraction, error detection)
- Image inline data (base64)
- Finish reason mapping
- Usage metadata (prompt/completion/total/cached tokens)
- Streaming text + tool call accumulation

### 🟡 Known Gaps (Low Severity)

| Gap                             | Anthropic | OpenAI Chat | Responses   |
| ------------------------------- | --------- | ----------- | ----------- |
| `cache_creation_input_tokens`   | Missing   | N/A         | N/A         |
| Audio URI (fileData)            | N/A       | Missing     | N/A         |
| Audio output                    | N/A       | Missing     | N/A         |
| Refusal text                    | N/A       | Missing     | N/A         |
| URL citation annotations        | N/A       | Missing     | N/A         |
| Non-image inlineData on request | N/A       | N/A         | **Missing** |
| fileData (URI media) on request | N/A       | N/A         | **Missing** |

### 🔴 No Critical Gaps Found

All core agentic functionality is preserved:

- Tool call → tool result round-trip is clean on all three wires
- Thinking/reasoning content survives all conversions
- Streaming doesn't lose data (tool call JSON truncation is detected and
  reported)

---

## How to Maintain This Audit

Run the automated invariance test:

```bash
npx vitest run packages/core/src/core/wireInvariance.test.ts
```

The test constructs canonical Gemini `Part[]` payloads and round-trips them
through each converter, asserting no silent data loss. When adding new Part
types or wire features, add a corresponding fixture to the test harness.
