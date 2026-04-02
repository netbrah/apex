/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const SERVICE_NAME = 'apex';

export const EVENT_USER_PROMPT = 'apex.user_prompt';
export const EVENT_USER_RETRY = 'apex.user_retry';
export const EVENT_TOOL_CALL = 'apex.tool_call';
export const EVENT_API_REQUEST = 'apex.api_request';
export const EVENT_API_ERROR = 'apex.api_error';
export const EVENT_API_CANCEL = 'apex.api_cancel';
export const EVENT_API_RESPONSE = 'apex.api_response';
export const EVENT_CLI_CONFIG = 'apex.config';
export const EVENT_EXTENSION_DISABLE = 'apex.extension_disable';
export const EVENT_EXTENSION_ENABLE = 'apex.extension_enable';
export const EVENT_EXTENSION_INSTALL = 'apex.extension_install';
export const EVENT_EXTENSION_UNINSTALL = 'apex.extension_uninstall';
export const EVENT_EXTENSION_UPDATE = 'apex.extension_update';
export const EVENT_FLASH_FALLBACK = 'apex.flash_fallback';
export const EVENT_RIPGREP_FALLBACK = 'apex.ripgrep_fallback';
export const EVENT_NEXT_SPEAKER_CHECK = 'apex.next_speaker_check';
export const EVENT_SLASH_COMMAND = 'apex.slash_command';
export const EVENT_IDE_CONNECTION = 'apex.ide_connection';
export const EVENT_CHAT_COMPRESSION = 'apex.chat_compression';
export const EVENT_TOOL_OUTPUT_MASKING = 'apex.tool_output_masking';
export const EVENT_INVALID_CHUNK = 'apex.chat.invalid_chunk';
export const EVENT_CONTENT_RETRY = 'apex.chat.content_retry';
export const EVENT_CONTENT_RETRY_FAILURE = 'apex.chat.content_retry_failure';
export const EVENT_CONVERSATION_FINISHED = 'apex.conversation_finished';
export const EVENT_MALFORMED_JSON_RESPONSE = 'apex.malformed_json_response';
export const EVENT_FILE_OPERATION = 'apex.file_operation';
export const EVENT_MODEL_SLASH_COMMAND = 'apex.slash_command.model';
export const EVENT_SUBAGENT_EXECUTION = 'apex.subagent_execution';
export const EVENT_SKILL_LAUNCH = 'apex.skill_launch';
export const EVENT_AUTH = 'apex.auth';
export const EVENT_USER_FEEDBACK = 'apex.user_feedback';

// Arena Events
export const EVENT_ARENA_SESSION_STARTED = 'apex.arena_session_started';
export const EVENT_ARENA_AGENT_COMPLETED = 'apex.arena_agent_completed';
export const EVENT_ARENA_SESSION_ENDED = 'apex.arena_session_ended';

// Performance Events
export const EVENT_STARTUP_PERFORMANCE = 'apex.startup.performance';
export const EVENT_MEMORY_USAGE = 'apex.memory.usage';
export const EVENT_PERFORMANCE_BASELINE = 'apex.performance.baseline';
export const EVENT_PERFORMANCE_REGRESSION = 'apex.performance.regression';
