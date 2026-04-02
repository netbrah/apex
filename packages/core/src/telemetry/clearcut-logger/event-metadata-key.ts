/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Defines valid event metadata keys for Clearcut logging.
export enum EventMetadataKey {
  // Deleted enums: 24
  // Next ID: 195

  APEX_KEY_UNKNOWN = 0,

  // ==========================================================================
  // Start Session Event Keys
  // ===========================================================================

  // Logs the model id used in the session.
  APEX_START_SESSION_MODEL = 1,

  // Logs the embedding model id used in the session.
  APEX_START_SESSION_EMBEDDING_MODEL = 2,

  // Logs the sandbox that was used in the session.
  APEX_START_SESSION_SANDBOX = 3,

  // Logs the core tools that were enabled in the session.
  APEX_START_SESSION_CORE_TOOLS = 4,

  // Logs the approval mode that was used in the session.
  APEX_START_SESSION_APPROVAL_MODE = 5,

  // Logs whether an API key was used in the session.
  APEX_START_SESSION_API_KEY_ENABLED = 6,

  // Logs whether the Vertex API was used in the session.
  APEX_START_SESSION_VERTEX_API_ENABLED = 7,

  // Logs whether debug mode was enabled in the session.
  APEX_START_SESSION_DEBUG_MODE_ENABLED = 8,

  // Logs the MCP servers that were enabled in the session.
  APEX_START_SESSION_MCP_SERVERS = 9,

  // Logs whether user-collected telemetry was enabled in the session.
  APEX_START_SESSION_TELEMETRY_ENABLED = 10,

  // Logs whether prompt collection was enabled for user-collected telemetry.
  APEX_START_SESSION_TELEMETRY_LOG_USER_PROMPTS_ENABLED = 11,

  // Logs whether the session was configured to respect gitignore files.
  APEX_START_SESSION_RESPECT_GITIGNORE = 12,

  // Logs the output format of the session.
  APEX_START_SESSION_OUTPUT_FORMAT = 94,

  // ==========================================================================
  // Startup Stats Event Keys
  // ==========================================================================

  // Logs the array of startup phases.
  APEX_STARTUP_PHASES = 172,

  // Logs the OS platform for startup stats.
  APEX_STARTUP_OS_PLATFORM = 173,

  // Logs the OS release for startup stats.
  APEX_STARTUP_OS_RELEASE = 174,

  // Logs whether the CLI is running in docker for startup stats.
  APEX_STARTUP_IS_DOCKER = 175,

  // ==========================================================================
  // User Prompt Event Keys
  // ===========================================================================

  // Logs the length of the prompt.
  APEX_USER_PROMPT_LENGTH = 13,

  // ==========================================================================
  // Tool Call Event Keys
  // ===========================================================================

  // Logs the function name.
  APEX_TOOL_CALL_NAME = 14,

  // Logs the MCP server name.
  APEX_TOOL_CALL_MCP_SERVER_NAME = 95,

  // Logs the user's decision about how to handle the tool call.
  APEX_TOOL_CALL_DECISION = 15,

  // Logs whether the tool call succeeded.
  APEX_TOOL_CALL_SUCCESS = 16,

  // Logs the tool call duration in milliseconds.
  APEX_TOOL_CALL_DURATION_MS = 17,

  // Do not use.
  DEPRECATED_APEX_TOOL_ERROR_MESSAGE = 18,

  // Logs the tool call error type, if any.
  APEX_TOOL_CALL_ERROR_TYPE = 19,

  // Logs the length of tool output
  APEX_TOOL_CALL_CONTENT_LENGTH = 93,

  // ==========================================================================
  // Replace Tool Call Event Keys
  // ===========================================================================

  // Logs a edit tool strategy choice.
  APEX_EDIT_STRATEGY = 109,

  // Logs a edit correction event.
  APEX_EDIT_CORRECTION = 110,

  // Logs the reason for web fetch fallback.
  APEX_WEB_FETCH_FALLBACK_REASON = 116,

  // ==========================================================================
  // GenAI API Request Event Keys
  // ===========================================================================

  // Logs the model id of the request.
  APEX_API_REQUEST_MODEL = 20,

  // ==========================================================================
  // GenAI API Response Event Keys
  // ===========================================================================

  // Logs the model id of the API call.
  APEX_API_RESPONSE_MODEL = 21,

  // Logs the status code of the response.
  APEX_API_RESPONSE_STATUS_CODE = 22,

  // Logs the duration of the API call in milliseconds.
  APEX_API_RESPONSE_DURATION_MS = 23,

  // Logs the input token count of the API call.
  APEX_API_RESPONSE_INPUT_TOKEN_COUNT = 25,

  // Logs the output token count of the API call.
  APEX_API_RESPONSE_OUTPUT_TOKEN_COUNT = 26,

  // Logs the cached token count of the API call.
  APEX_API_RESPONSE_CACHED_TOKEN_COUNT = 27,

  // Logs the thinking token count of the API call.
  APEX_API_RESPONSE_THINKING_TOKEN_COUNT = 28,

  // Logs the tool use token count of the API call.
  APEX_API_RESPONSE_TOOL_TOKEN_COUNT = 29,

  // Logs the token count for system instructions.
  APEX_API_RESPONSE_CONTEXT_BREAKDOWN_SYSTEM_INSTRUCTIONS = 167,

  // Logs the token count for tool definitions.
  APEX_API_RESPONSE_CONTEXT_BREAKDOWN_TOOL_DEFINITIONS = 168,

  // Logs the token count for conversation history.
  APEX_API_RESPONSE_CONTEXT_BREAKDOWN_HISTORY = 169,

  // Logs the token count for tool calls (JSON map of tool name to tokens).
  APEX_API_RESPONSE_CONTEXT_BREAKDOWN_TOOL_CALLS = 170,

  // Logs the token count from MCP servers (tool definitions + tool inputs/outputs).
  APEX_API_RESPONSE_CONTEXT_BREAKDOWN_MCP_SERVERS = 171,

  // ==========================================================================
  // GenAI API Error Event Keys
  // ===========================================================================

  // Logs the model id of the API call.
  APEX_API_ERROR_MODEL = 30,

  // Logs the error type.
  APEX_API_ERROR_TYPE = 31,

  // Logs the status code of the error response.
  APEX_API_ERROR_STATUS_CODE = 32,

  // Logs the duration of the API call in milliseconds.
  APEX_API_ERROR_DURATION_MS = 33,

  // ==========================================================================
  // End Session Event Keys
  // ===========================================================================

  // Logs the end of a session.
  APEX_END_SESSION_ID = 34,

  // ==========================================================================
  // Shared Keys
  // ===========================================================================

  // Logs the Prompt Id
  APEX_PROMPT_ID = 35,

  // Logs the Auth type for the prompt, api responses and errors.
  APEX_AUTH_TYPE = 36,

  // Logs the total number of Google accounts ever used.
  APEX_GOOGLE_ACCOUNTS_COUNT = 37,

  // Logs the Surface from where the Gemini CLI was invoked, eg: VSCode.
  APEX_SURFACE = 39,

  // Logs the session id
  APEX_SESSION_ID = 40,

  // Logs the Gemini CLI version
  APEX_VERSION = 54,

  // Logs the Gemini CLI Git commit hash
  APEX_GIT_COMMIT_HASH = 55,

  // Logs the Gemini CLI OS
  APEX_OS = 82,

  // Logs active user settings
  APEX_USER_SETTINGS = 84,

  // Logs the name of the GitHub Action workflow that triggered the session.
  APEX_GH_WORKFLOW_NAME = 130,

  // Logs the active experiment IDs for the session.
  APEX_EXPERIMENT_IDS = 131,

  // Logs the repository name of the GitHub Action that triggered the session.
  APEX_GH_REPOSITORY_NAME_HASH = 132,

  // Logs the event name of the GitHub Action that triggered the session.
  APEX_GH_EVENT_NAME = 176,

  // Logs the Pull Request number if the workflow is operating on a PR.
  APEX_GH_PR_NUMBER = 177,

  // Logs the Issue number if the workflow is operating on an Issue.
  APEX_GH_ISSUE_NUMBER = 178,

  // Logs a custom tracking string (e.g. a comma-separated list of issue IDs for scheduled batches).
  APEX_GH_CUSTOM_TRACKING_ID = 179,

  // ==========================================================================
  // Loop Detected Event Keys
  // ===========================================================================

  // Logs the type of loop detected.
  APEX_LOOP_DETECTED_TYPE = 38,

  // ==========================================================================
  // Slash Command Event Keys
  // ===========================================================================

  // Logs the name of the slash command.
  APEX_SLASH_COMMAND_NAME = 41,

  // Logs the subcommand of the slash command.
  APEX_SLASH_COMMAND_SUBCOMMAND = 42,

  // Logs the status of the slash command (e.g. 'success', 'error')
  APEX_SLASH_COMMAND_STATUS = 51,

  // ==========================================================================
  // Next Speaker Check Event Keys
  // ===========================================================================

  // Logs the finish reason of the previous streamGenerateContent response
  APEX_RESPONSE_FINISH_REASON = 43,

  // Logs the result of the next speaker check
  APEX_NEXT_SPEAKER_CHECK_RESULT = 44,

  // ==========================================================================
  // Malformed JSON Response Event Keys
  // ==========================================================================

  // Logs the model that produced the malformed JSON response.
  APEX_MALFORMED_JSON_RESPONSE_MODEL = 45,

  // ==========================================================================
  // IDE Connection Event Keys
  // ===========================================================================

  // Logs the type of the IDE connection.
  APEX_IDE_CONNECTION_TYPE = 46,

  // Logs AI added lines in edit/write tool response.
  APEX_AI_ADDED_LINES = 47,

  // Logs AI removed lines in edit/write tool response.
  APEX_AI_REMOVED_LINES = 48,

  // Logs user added lines in edit/write tool response.
  APEX_USER_ADDED_LINES = 49,

  // Logs user removed lines in edit/write tool response.
  APEX_USER_REMOVED_LINES = 50,

  // Logs AI added characters in edit/write tool response.
  APEX_AI_ADDED_CHARS = 103,

  // Logs AI removed characters in edit/write tool response.
  APEX_AI_REMOVED_CHARS = 104,

  // Logs user added characters in edit/write tool response.
  APEX_USER_ADDED_CHARS = 105,

  // Logs user removed characters in edit/write tool response.
  APEX_USER_REMOVED_CHARS = 106,

  // ==========================================================================
  // Kitty Sequence Overflow Event Keys
  // ===========================================================================

  // Do not use.
  DEPRECATED_APEX_KITTY_TRUNCATED_SEQUENCE = 52,

  // Logs the length of the kitty sequence that overflowed.
  APEX_KITTY_SEQUENCE_LENGTH = 53,

  // ==========================================================================
  // Conversation Finished Event Keys
  // ===========================================================================

  // Logs the approval mode of the session.
  APEX_APPROVAL_MODE = 58,

  // Logs the number of turns
  APEX_CONVERSATION_TURN_COUNT = 59,

  // Logs the number of tokens before context window compression.
  APEX_COMPRESSION_TOKENS_BEFORE = 60,

  // Logs the number of tokens after context window compression.
  APEX_COMPRESSION_TOKENS_AFTER = 61,

  // Logs tool type whether it is mcp or native.
  APEX_TOOL_TYPE = 62,

  // Logs count of MCP servers in Start Session Event
  APEX_START_SESSION_MCP_SERVERS_COUNT = 63,

  // Logs count of MCP tools in Start Session Event
  APEX_START_SESSION_MCP_TOOLS_COUNT = 64,

  // Logs name of MCP tools as comma separated string
  APEX_START_SESSION_MCP_TOOLS = 65,

  // ==========================================================================
  // Research Event Keys
  // ===========================================================================

  // Logs the research opt-in status (true/false)
  APEX_RESEARCH_OPT_IN_STATUS = 66,

  // Logs the contact email for research participation
  APEX_RESEARCH_CONTACT_EMAIL = 67,

  // Logs the user ID for research events
  APEX_RESEARCH_USER_ID = 68,

  // Logs the type of research feedback
  APEX_RESEARCH_FEEDBACK_TYPE = 69,

  // Logs the content of research feedback
  APEX_RESEARCH_FEEDBACK_CONTENT = 70,

  // Logs survey responses for research feedback (JSON stringified)
  APEX_RESEARCH_SURVEY_RESPONSES = 71,

  // ==========================================================================
  // File Operation Event Keys
  // ===========================================================================

  // Logs the programming language of the project.
  APEX_PROGRAMMING_LANGUAGE = 56,

  // Logs the operation type of the file operation.
  APEX_FILE_OPERATION_TYPE = 57,

  // Logs the number of lines in the file operation.
  APEX_FILE_OPERATION_LINES = 72,

  // Logs the mimetype of the file in the file operation.
  APEX_FILE_OPERATION_MIMETYPE = 73,

  // Logs the extension of the file in the file operation.
  APEX_FILE_OPERATION_EXTENSION = 74,

  // ==========================================================================
  // Content Streaming Event Keys
  // ===========================================================================

  // Logs the error message for an invalid chunk.
  APEX_INVALID_CHUNK_ERROR_MESSAGE = 75,

  // Logs the attempt number for a content retry.
  APEX_CONTENT_RETRY_ATTEMPT_NUMBER = 76,

  // Logs the error type for a content retry.
  APEX_CONTENT_RETRY_ERROR_TYPE = 77,

  // Logs the delay in milliseconds for a content retry.
  APEX_CONTENT_RETRY_DELAY_MS = 78,

  // Logs the total number of attempts for a content retry failure.
  APEX_CONTENT_RETRY_FAILURE_TOTAL_ATTEMPTS = 79,

  // Logs the final error type for a content retry failure.
  APEX_CONTENT_RETRY_FAILURE_FINAL_ERROR_TYPE = 80,

  // Logs the total duration in milliseconds for a content retry failure.
  APEX_CONTENT_RETRY_FAILURE_TOTAL_DURATION_MS = 81,

  // Logs the current nodejs version
  APEX_NODE_VERSION = 83,

  // ==========================================================================
  // Extension Event Keys
  // ===========================================================================

  // Logs the name of the extension.
  APEX_EXTENSION_NAME = 85,

  // Logs the name of the extension.
  APEX_EXTENSION_ID = 121,

  // Logs the version of the extension.
  APEX_EXTENSION_VERSION = 86,

  // Logs the previous version of the extension.
  APEX_EXTENSION_PREVIOUS_VERSION = 117,

  // Logs the source of the extension.
  APEX_EXTENSION_SOURCE = 87,

  // Logs the status of the extension install.
  APEX_EXTENSION_INSTALL_STATUS = 88,

  // Logs the status of the extension uninstall
  APEX_EXTENSION_UNINSTALL_STATUS = 96,

  // Logs the status of the extension uninstall
  APEX_EXTENSION_UPDATE_STATUS = 118,

  // Logs the count of extensions in Start Session Event
  APEX_START_SESSION_EXTENSIONS_COUNT = 119,

  // Logs the name of extensions as a comma-separated string
  APEX_START_SESSION_EXTENSION_IDS = 120,

  // Logs whether the session is running in a Git worktree.
  APEX_START_SESSION_WORKTREE_ACTIVE = 191,

  // Logs the setting scope for an extension enablement.
  APEX_EXTENSION_ENABLE_SETTING_SCOPE = 102,

  // Logs the setting scope for an extension disablement.
  APEX_EXTENSION_DISABLE_SETTING_SCOPE = 107,

  // ==========================================================================
  // Tool Output Truncated Event Keys
  // ===========================================================================

  // Logs the original length of the tool output.
  APEX_TOOL_OUTPUT_TRUNCATED_ORIGINAL_LENGTH = 89,

  // Logs the truncated length of the tool output.
  APEX_TOOL_OUTPUT_TRUNCATED_TRUNCATED_LENGTH = 90,

  // Logs the threshold at which the tool output was truncated.
  APEX_TOOL_OUTPUT_TRUNCATED_THRESHOLD = 91,

  // Logs the number of lines the tool output was truncated to.
  APEX_TOOL_OUTPUT_TRUNCATED_LINES = 92,

  // ==========================================================================
  // Model Router Event Keys
  // ==========================================================================

  // Logs the outcome of a model routing decision (e.g., which route/model was
  // selected).
  APEX_ROUTING_DECISION = 97,

  // Logs an event when the model router fails to make a decision or the chosen
  // route fails.
  APEX_ROUTING_FAILURE = 98,

  // Logs the latency in milliseconds for the router to make a decision.
  APEX_ROUTING_LATENCY_MS = 99,

  // Logs a specific reason for a routing failure.
  APEX_ROUTING_FAILURE_REASON = 100,

  // Logs the source of the decision.
  APEX_ROUTING_DECISION_SOURCE = 101,

  // Logs an event when the user uses the /model command.
  APEX_MODEL_SLASH_COMMAND = 108,

  // ==========================================================================
  // Agent Event Keys
  // ==========================================================================

  // Logs the name of the agent.
  APEX_AGENT_NAME = 111,

  // Logs the unique ID of the agent instance.
  APEX_AGENT_ID = 112,

  // Logs the duration of the agent execution in milliseconds.
  APEX_AGENT_DURATION_MS = 113,

  // Logs the number of turns the agent took.
  APEX_AGENT_TURN_COUNT = 114,

  // Logs the reason for agent termination.
  APEX_AGENT_TERMINATE_REASON = 115,

  // Logs the reason for an agent recovery attempt.
  APEX_AGENT_RECOVERY_REASON = 122,

  // Logs the duration of an agent recovery attempt in milliseconds.
  APEX_AGENT_RECOVERY_DURATION_MS = 123,

  // Logs whether the agent recovery attempt was successful.
  APEX_AGENT_RECOVERY_SUCCESS = 124,

  // Logs whether the session is interactive.
  APEX_INTERACTIVE = 125,

  // ==========================================================================
  // LLM Loop Check Event Keys
  // ==========================================================================

  // Logs the confidence score from the flash model loop check.
  APEX_LLM_LOOP_CHECK_FLASH_CONFIDENCE = 126,

  // Logs the name of the main model used for the secondary loop check.
  APEX_LLM_LOOP_CHECK_MAIN_MODEL = 127,

  // Logs the confidence score from the main model loop check.
  APEX_LLM_LOOP_CHECK_MAIN_MODEL_CONFIDENCE = 128,

  // Logs the model that confirmed the loop.
  APEX_LOOP_DETECTED_CONFIRMED_BY_MODEL = 129,

  // ==========================================================================
  // Hook Call Event Keys
  // ==========================================================================

  // Logs the name of the hook event (e.g., 'BeforeTool', 'AfterModel').
  APEX_HOOK_EVENT_NAME = 133,

  // Logs the duration of the hook execution in milliseconds.
  APEX_HOOK_DURATION_MS = 134,

  // Logs whether the hook execution was successful.
  APEX_HOOK_SUCCESS = 135,

  // Logs the exit code of the hook script (if applicable).
  APEX_HOOK_EXIT_CODE = 136,

  // Logs CPU information of user machine.
  APEX_CPU_INFO = 137,

  // Logs number of CPU cores of user machine.
  APEX_CPU_CORES = 138,

  // Logs GPU information of user machine.
  APEX_GPU_INFO = 139,

  // Logs total RAM in GB of user machine.
  APEX_RAM_TOTAL_GB = 140,

  // ==========================================================================
  // Approval Mode Event Keys
  // ==========================================================================

  // Logs the active approval mode in the session.
  APEX_ACTIVE_APPROVAL_MODE = 141,

  // Logs the new approval mode.
  APEX_APPROVAL_MODE_TO = 142,

  // Logs the duration spent in an approval mode in milliseconds.
  APEX_APPROVAL_MODE_DURATION_MS = 143,

  // ==========================================================================
  // Rewind Event Keys
  // ==========================================================================

  // Logs the outcome of a rewind operation.
  APEX_REWIND_OUTCOME = 144,

  // Model Routing Event Keys (Cont.)
  // ==========================================================================

  // Logs the reasoning for the routing decision.
  APEX_ROUTING_REASONING = 145,

  // Logs whether numerical routing was enabled.
  APEX_ROUTING_NUMERICAL_ENABLED = 146,

  // Logs the classifier threshold used.
  APEX_ROUTING_CLASSIFIER_THRESHOLD = 147,

  // ==========================================================================
  // Tool Output Masking Event Keys
  // ==========================================================================

  // Logs the total tokens in the prunable block before masking.
  APEX_TOOL_OUTPUT_MASKING_TOKENS_BEFORE = 148,

  // Logs the total tokens in the masked remnants after masking.
  APEX_TOOL_OUTPUT_MASKING_TOKENS_AFTER = 149,

  // Logs the number of tool outputs masked in this operation.
  APEX_TOOL_OUTPUT_MASKING_MASKED_COUNT = 150,

  // Logs the total prunable tokens identified at the trigger point.
  APEX_TOOL_OUTPUT_MASKING_TOTAL_PRUNABLE_TOKENS = 151,

  // Ask User Stats Event Keys
  // ==========================================================================

  // Logs the types of questions asked in the ask_user tool.
  APEX_ASK_USER_QUESTION_TYPES = 152,

  // Logs whether the ask_user dialog was dismissed.
  APEX_ASK_USER_DISMISSED = 153,

  // Logs whether the ask_user dialog was submitted empty.
  APEX_ASK_USER_EMPTY_SUBMISSION = 154,

  // Logs the number of questions answered in the ask_user tool.
  APEX_ASK_USER_ANSWER_COUNT = 155,

  // ==========================================================================
  // Keychain & Token Storage Event Keys
  // ==========================================================================

  // Logs whether the keychain is available.
  APEX_KEYCHAIN_AVAILABLE = 156,

  // Logs the type of token storage initialized.
  APEX_TOKEN_STORAGE_TYPE = 157,

  // Logs whether the token storage type was forced by an environment variable.
  APEX_TOKEN_STORAGE_FORCED = 158,
  // Conseca Event Keys
  // ==========================================================================

  // Logs the policy generation event.
  CONSECA_POLICY_GENERATION = 159,

  // Logs the verdict event.
  CONSECA_VERDICT = 160,

  // Logs the generated policy content.
  CONSECA_GENERATED_POLICY = 161,

  // Logs the verdict result (e.g. ALLOW/BLOCK).
  CONSECA_VERDICT_RESULT = 162,

  // Logs the verdict rationale.
  CONSECA_VERDICT_RATIONALE = 163,

  // Logs the trusted content used.
  CONSECA_TRUSTED_CONTENT = 164,

  // Logs the user prompt for Conseca events.
  CONSECA_USER_PROMPT = 165,

  // Logs the error message for Conseca events.
  CONSECA_ERROR = 166,

  // ==========================================================================
  // Network Retry Event Keys
  // ==========================================================================

  // Logs the attempt number for a network retry.
  APEX_NETWORK_RETRY_ATTEMPT_NUMBER = 180,

  // Logs the delay in milliseconds for a network retry.
  APEX_NETWORK_RETRY_DELAY_MS = 181,

  // Logs the error type for a network retry.
  APEX_NETWORK_RETRY_ERROR_TYPE = 182,

  // ==========================================================================
  // Billing / AI Credits Event Keys
  // ==========================================================================

  // Logs the model associated with a billing event.
  APEX_BILLING_MODEL = 185,

  // Logs the number of AI credits consumed in a request.
  APEX_BILLING_CREDITS_CONSUMED = 186,

  // Logs the remaining AI credits after a request.
  APEX_BILLING_CREDITS_REMAINING = 187,

  // Logs the overage option selected by the user (e.g. use_credits, use_fallback, manage, stop).
  APEX_BILLING_SELECTED_OPTION = 188,

  // Logs the user's credit balance when the overage menu was shown.
  APEX_BILLING_CREDIT_BALANCE = 189,

  // Logs the source of a credit purchase click (e.g. overage_menu, empty_wallet_menu, manage).
  APEX_BILLING_PURCHASE_SOURCE = 190,

  // ==========================================================================
  // Gemini Enterprise (GE) Event Keys
  // ==========================================================================

  // Logs the start of the onboarding process.
  APEX_ONBOARDING_START = 192,

  // Logs the user tier for onboarding success events.
  APEX_ONBOARDING_USER_TIER = 193,

  // Logs the duration of the onboarding process in milliseconds.
  APEX_ONBOARDING_DURATION_MS = 194,
}
