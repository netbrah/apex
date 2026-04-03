/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  GoogleGenAI,
  type CountTokensResponse,
  type GenerateContentResponse,
  type GenerateContentParameters,
  type CountTokensParameters,
  type EmbedContentResponse,
  type EmbedContentParameters,
} from '@google/genai';
import * as os from 'node:os';
import { createCodeAssistContentGenerator } from '../code_assist/codeAssist.js';
import { isCloudShell } from '../ide/detect-ide.js';
import type { Config } from '../config/config.js';
import { loadApiKey } from './apiKeyCredentialStorage.js';

import type { UserTierId, GeminiUserTier } from '../code_assist/types.js';
import { LoggingContentGenerator } from './loggingContentGenerator.js';
import { InstallationManager } from '../utils/installationManager.js';
import { FakeContentGenerator } from './fakeContentGenerator.js';
import { parseCustomHeaders } from '../utils/customHeaderUtils.js';
import { determineSurface } from '../utils/surface.js';
import { RecordingContentGenerator } from './recordingContentGenerator.js';
import { getVersion, resolveModel } from '../../index.js';
import type { LlmRole } from '../telemetry/llmRole.js';

/**
 * Interface abstracting the core functionalities for generating content and counting tokens.
 */
export interface ContentGenerator {
  generateContent(
    request: GenerateContentParameters,
    userPromptId: string,
    role: LlmRole,
  ): Promise<GenerateContentResponse>;

  generateContentStream(
    request: GenerateContentParameters,
    userPromptId: string,
    role: LlmRole,
  ): Promise<AsyncGenerator<GenerateContentResponse>>;

  countTokens(request: CountTokensParameters): Promise<CountTokensResponse>;

  embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse>;

  userTier?: UserTierId;

  userTierName?: string;

  paidTier?: GeminiUserTier;
}

export enum AuthType {
  LOGIN_WITH_GOOGLE = 'oauth-personal',
  USE_GEMINI = 'gemini-api-key',
  USE_VERTEX_AI = 'vertex-ai',
  LEGACY_CLOUD_SHELL = 'cloud-shell',
  COMPUTE_ADC = 'compute-default-credentials',
  GATEWAY = 'gateway',
  // Fork-specific auth types for OpenAI-compatible and Anthropic backends
  USE_OPENAI = 'openai',
  USE_OPENAI_RESPONSES = 'openai-responses',
  USE_ANTHROPIC = 'anthropic',
}

/**
 * Supported input modalities for a model.
 * Omitted or false fields mean the model does not support that input type.
 */
export type InputModalities = {
  image?: boolean;
  pdf?: boolean;
  audio?: boolean;
  video?: boolean;
};

/**
 * Detects the best authentication type based on environment variables.
 *
 * Checks in order:
 * 1. GOOGLE_GENAI_USE_GCA=true -> LOGIN_WITH_GOOGLE
 * 2. GOOGLE_GENAI_USE_VERTEXAI=true -> USE_VERTEX_AI
 * 3. GEMINI_API_KEY -> USE_GEMINI
 */
export function getAuthTypeFromEnv(): AuthType | undefined {
  // Fork-specific: detect OpenAI/Anthropic auth from env before Google checks
  if (process.env['ANTHROPIC_API_KEY'] && process.env['ANTHROPIC_BASE_URL']) {
    return AuthType.USE_ANTHROPIC;
  }
  if (process.env['OPENAI_API_KEY']) {
    // Use responses API if explicitly requested, otherwise default to openai-responses
    const apiType = process.env['OPENAI_API_TYPE']?.toLowerCase();
    if (apiType === 'chat-completions' || apiType === 'openai') {
      return AuthType.USE_OPENAI;
    }
    return AuthType.USE_OPENAI_RESPONSES;
  }
  if (process.env['GOOGLE_GENAI_USE_GCA'] === 'true') {
    return AuthType.LOGIN_WITH_GOOGLE;
  }
  if (process.env['GOOGLE_GENAI_USE_VERTEXAI'] === 'true') {
    return AuthType.USE_VERTEX_AI;
  }
  if (process.env['GEMINI_API_KEY']) {
    return AuthType.USE_GEMINI;
  }
  if (
    process.env['CLOUD_SHELL'] === 'true' ||
    process.env['APEX_USE_COMPUTE_ADC'] === 'true'
  ) {
    return AuthType.COMPUTE_ADC;
  }
  return undefined;
}

export type ContentGeneratorConfig = {
  apiKey?: string;
  vertexai?: boolean;
  authType?: AuthType;
  proxy?: string;
  baseUrl?: string;
  customHeaders?: Record<string, string>;
  // Fork-specific fields for OpenAI/Anthropic backends
  model?: string;
  apiKeyEnvKey?: string;
  enableOpenAILogging?: boolean;
  openAILoggingDir?: string;
  timeout?: number;
  maxRetries?: number;
  retryErrorCodes?: number[];
  enableCacheControl?: boolean;
  samplingParams?: {
    top_p?: number;
    top_k?: number;
    repetition_penalty?: number;
    presence_penalty?: number;
    frequency_penalty?: number;
    temperature?: number;
    max_tokens?: number;
  };
  reasoning?:
    | false
    | {
        effort?: 'low' | 'medium' | 'high';
        budget_tokens?: number;
        summary?: 'auto' | 'concise' | 'detailed';
      };
  verbosity?: 'low' | 'medium' | 'high';
  serviceTier?: 'auto' | 'priority';
  userAgent?: string;
  schemaCompliance?: 'auto' | 'openapi_30';
  contextWindowSize?: number;
  extra_body?: Record<string, unknown>;
  modalities?: InputModalities;
  enableEncryptedContentReplay?: boolean;
};

/**
 * Tracks the source of each field in a ContentGeneratorConfig.
 * Re-uses the ConfigSources type from the config resolver for compatibility.
 */
export type { ConfigSources as ContentGeneratorConfigSources } from '../utils/configResolver.js';

/**
 * Result of validating a model configuration.
 */
export interface ModelConfigValidationResult {
  valid: boolean;
  errors: Error[];
}

/**
 * Validates that a ContentGeneratorConfig has the minimum required fields.
 */
export function validateModelConfig(
  config: ContentGeneratorConfig,
): ModelConfigValidationResult {
  const errors: Error[] = [];
  if (!config.apiKey) {
    errors.push(new Error(`Missing API key for auth type: ${config.authType}`));
  }
  if (!config.model) {
    errors.push(new Error(`Missing model for auth type: ${config.authType}`));
  }
  return { valid: errors.length === 0, errors };
}

export async function createContentGeneratorConfig(
  config: Config,
  authType: AuthType | undefined,
  apiKey?: string,
  baseUrl?: string,
  customHeaders?: Record<string, string>,
): Promise<ContentGeneratorConfig> {
  const geminiApiKey =
    apiKey ||
    process.env['GEMINI_API_KEY'] ||
    (await loadApiKey()) ||
    undefined;
  const googleApiKey = process.env['GOOGLE_API_KEY'] || undefined;
  const googleCloudProject =
    process.env['GOOGLE_CLOUD_PROJECT'] ||
    process.env['GOOGLE_CLOUD_PROJECT_ID'] ||
    undefined;
  const googleCloudLocation = process.env['GOOGLE_CLOUD_LOCATION'] || undefined;

  const contentGeneratorConfig: ContentGeneratorConfig = {
    authType,
    proxy: config?.getProxy(),
    baseUrl,
    customHeaders,
  };

  // If we are using Google auth or we are in Cloud Shell, there is nothing else to validate for now
  if (
    authType === AuthType.LOGIN_WITH_GOOGLE ||
    authType === AuthType.COMPUTE_ADC
  ) {
    return contentGeneratorConfig;
  }

  if (authType === AuthType.USE_GEMINI && geminiApiKey) {
    contentGeneratorConfig.apiKey = geminiApiKey;
    contentGeneratorConfig.vertexai = false;

    return contentGeneratorConfig;
  }

  if (
    authType === AuthType.USE_VERTEX_AI &&
    (googleApiKey || (googleCloudProject && googleCloudLocation))
  ) {
    contentGeneratorConfig.apiKey = googleApiKey;
    contentGeneratorConfig.vertexai = true;

    return contentGeneratorConfig;
  }

  if (authType === AuthType.GATEWAY) {
    contentGeneratorConfig.apiKey = apiKey || 'gateway-placeholder-key';
    contentGeneratorConfig.vertexai = false;

    return contentGeneratorConfig;
  }

  // Fork-specific: handle OpenAI/Anthropic auth config from environment
  if (
    authType === AuthType.USE_OPENAI ||
    authType === AuthType.USE_OPENAI_RESPONSES
  ) {
    contentGeneratorConfig.apiKey =
      apiKey || process.env['OPENAI_API_KEY'] || undefined;
    contentGeneratorConfig.baseUrl =
      baseUrl || process.env['OPENAI_BASE_URL'] || undefined;
    contentGeneratorConfig.model =
      process.env['OPENAI_MODEL'] || process.env['APEX_MODEL'] || undefined;
    return contentGeneratorConfig;
  }

  if (authType === AuthType.USE_ANTHROPIC) {
    contentGeneratorConfig.apiKey =
      apiKey || process.env['ANTHROPIC_API_KEY'] || undefined;
    contentGeneratorConfig.baseUrl =
      baseUrl || process.env['ANTHROPIC_BASE_URL'] || undefined;
    contentGeneratorConfig.model =
      process.env['ANTHROPIC_MODEL'] || undefined;
    return contentGeneratorConfig;
  }

  return contentGeneratorConfig;
}

export async function createContentGenerator(
  config: ContentGeneratorConfig,
  gcConfig: Config,
  sessionId?: string,
): Promise<ContentGenerator> {
  const generator = await (async () => {
    if (gcConfig.fakeResponses) {
      const fakeGenerator = await FakeContentGenerator.fromFile(
        gcConfig.fakeResponses,
      );
      return new LoggingContentGenerator(fakeGenerator, gcConfig);
    }

    // Fork-specific: dispatch to OpenAI/Anthropic backends
    if (config.authType === AuthType.USE_OPENAI) {
      const { createOpenAIContentGenerator } = await import(
        './openaiContentGenerator/index.js'
      );
      const baseGenerator = createOpenAIContentGenerator(config, gcConfig);
      return new LoggingContentGenerator(baseGenerator, gcConfig);
    }

    if (config.authType === AuthType.USE_OPENAI_RESPONSES) {
      const { createOpenAIResponsesContentGenerator } = await import(
        './openaiResponsesContentGenerator/index.js'
      );
      const baseGenerator = createOpenAIResponsesContentGenerator(
        config,
        gcConfig,
      );
      return new LoggingContentGenerator(baseGenerator, gcConfig);
    }

    if (config.authType === AuthType.USE_ANTHROPIC) {
      const { createAnthropicContentGenerator } = await import(
        './anthropicContentGenerator/index.js'
      );
      const baseGenerator = createAnthropicContentGenerator(config, gcConfig);
      return new LoggingContentGenerator(baseGenerator, gcConfig);
    }

    // Upstream Google-specific auth flows below
    const version = await getVersion();
    const model = resolveModel(
      gcConfig.getModel(),
      config.authType === AuthType.USE_GEMINI ||
        config.authType === AuthType.USE_VERTEX_AI ||
        ((await gcConfig.getGemini31Launched?.()) ?? false),
      config.authType === AuthType.USE_GEMINI ||
        config.authType === AuthType.USE_VERTEX_AI ||
        ((await gcConfig.getGemini31FlashLiteLaunched?.()) ?? false),
      false,
      gcConfig.getHasAccessToPreviewModel?.() ?? true,
      gcConfig,
    );
    const customHeadersEnv =
      process.env['APEX_CUSTOM_HEADERS'] || undefined;
    const clientName = gcConfig.getClientName();
    const surface = determineSurface();

    let userAgent: string;
    // Use unified format for VS Code traffic.
    // Note: We don't automatically assume a2a-server is VS Code,
    // as it could be used by other clients unless the surface explicitly says 'vscode'.
    if (clientName === 'acp-vscode' || surface === 'vscode') {
      const osTypeMap: Record<string, string> = {
        darwin: 'macOS',
        win32: 'Windows',
        linux: 'Linux',
      };
      const osType = osTypeMap[process.platform] || process.platform;
      const osVersion = os.release();
      const arch = process.arch;

      const vscodeVersion = process.env['TERM_PROGRAM_VERSION'] || 'unknown';
      let hostPath = `VSCode/${vscodeVersion}`;
      if (isCloudShell()) {
        const cloudShellVersion =
          process.env['CLOUD_SHELL_VERSION'] || 'unknown';
        hostPath += ` > CloudShell/${cloudShellVersion}`;
      }

      userAgent = `CloudCodeVSCode/${version} (aidev_client; os_type=${osType}; os_version=${osVersion}; arch=${arch}; host_path=${hostPath}; proxy_client=geminicli)`;
    } else {
      const userAgentPrefix = clientName
        ? `GeminiCLI-${clientName}`
        : 'GeminiCLI';
      userAgent = `${userAgentPrefix}/${version}/${model} (${process.platform}; ${process.arch}; ${surface})`;
    }

    const customHeadersMap = parseCustomHeaders(customHeadersEnv);
    const apiKeyAuthMechanism =
      process.env['GEMINI_API_KEY_AUTH_MECHANISM'] || 'x-goog-api-key';
    const apiVersionEnv = process.env['GOOGLE_GENAI_API_VERSION'];

    const baseHeaders: Record<string, string> = {
      'User-Agent': userAgent,
      ...customHeadersMap,
    };

    if (
      apiKeyAuthMechanism === 'bearer' &&
      (config.authType === AuthType.USE_GEMINI ||
        config.authType === AuthType.USE_VERTEX_AI) &&
      config.apiKey
    ) {
      baseHeaders['Authorization'] = `Bearer ${config.apiKey}`;
    }
    if (
      config.authType === AuthType.LOGIN_WITH_GOOGLE ||
      config.authType === AuthType.COMPUTE_ADC
    ) {
      const httpOptions = { headers: baseHeaders };
      return new LoggingContentGenerator(
        await createCodeAssistContentGenerator(
          httpOptions,
          config.authType,
          gcConfig,
          sessionId,
        ),
        gcConfig,
      );
    }

    if (
      config.authType === AuthType.USE_GEMINI ||
      config.authType === AuthType.USE_VERTEX_AI ||
      config.authType === AuthType.GATEWAY
    ) {
      let headers: Record<string, string> = { ...baseHeaders };
      if (config.customHeaders) {
        headers = { ...headers, ...config.customHeaders };
      }
      if (gcConfig?.getUsageStatisticsEnabled()) {
        const installationManager = new InstallationManager();
        const installationId = installationManager.getInstallationId();
        headers = {
          ...headers,
          'x-gemini-api-privileged-user-id': `${installationId}`,
        };
      }
      const httpOptions: {
        baseUrl?: string;
        headers: Record<string, string>;
      } = { headers };

      if (config.baseUrl) {
        httpOptions.baseUrl = config.baseUrl;
      }

      const googleGenAI = new GoogleGenAI({
        apiKey: config.apiKey === '' ? undefined : config.apiKey,
        vertexai: config.vertexai,
        httpOptions,
        ...(apiVersionEnv && { apiVersion: apiVersionEnv }),
      });
      return new LoggingContentGenerator(googleGenAI.models, gcConfig);
    }
    throw new Error(
      `Error creating contentGenerator: Unsupported authType: ${config.authType}`,
    );
  })();

  if (gcConfig.recordResponses) {
    return new RecordingContentGenerator(generator, gcConfig.recordResponses);
  }

  return generator;
}
