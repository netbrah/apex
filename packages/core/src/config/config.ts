/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Node built-ins
import type { EventEmitter } from 'node:events';
import * as path from 'node:path';
import process from 'node:process';

// External dependencies
import { ProxyAgent, setGlobalDispatcher } from 'undici';

// Types
import type {
  ContentGenerator,
  ContentGeneratorConfig,
} from '../core/contentGenerator.js';
import type { ContentGeneratorConfigSources } from '../core/contentGenerator.js';
import type { MCPOAuthConfig } from '../mcp/oauth-provider.js';
import type { ShellExecutionConfig } from '../services/shellExecutionService.js';
import type { AnyToolInvocation } from '../tools/tools.js';
import type { ArenaManager } from '../agents/arena/ArenaManager.js';
import { ArenaAgentClient } from '../agents/arena/ArenaAgentClient.js';

// Core
import { BaseLlmClient } from '../core/baseLlmClient.js';
import { GeminiClient } from '../core/client.js';
