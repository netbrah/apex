/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

import { AuthType } from '../core/contentGenerator.js';
import { defaultModalities } from '../core/modalityDefaults.js';
import { tokenLimit } from '../core/tokenLimits.js';
import { DEFAULT_OPENAI_BASE_URL } from '../core/openaiContentGenerator/constants.js';
import {
  type ModelConfig,
  type ModelProvidersConfig,
  type ResolvedModelConfig,
  type AvailableModel,
} from './types.js';
import { debugLogger } from '../utils/debugLogger.js';

/**
 * Validates if a string key is a valid AuthType enum value.
 * @param key - The key to validate
 * @returns The validated AuthType or undefined if invalid
 */
function validateAuthTypeKey(key: string): AuthType | undefined {
  // Check if the key is a valid AuthType enum value
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  if (Object.values(AuthType).includes(key as AuthType)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return key as AuthType;
  }

  // Invalid key
  return undefined;
}

/**
 * Central registry for managing model configurations.
 * Models are organized by authType.
 */
export class ModelRegistry {
  private modelsByAuthType: Map<AuthType, Map<string, ResolvedModelConfig>>;

  private getDefaultBaseUrl(authType: AuthType): string {
    switch (authType) {
      case AuthType.USE_OPENAI:
      case AuthType.USE_OPENAI_RESPONSES:
        return DEFAULT_OPENAI_BASE_URL;
      default:
        return '';
    }
  }

  constructor(modelProvidersConfig?: ModelProvidersConfig) {
    this.modelsByAuthType = new Map();

    if (modelProvidersConfig) {
      for (const [rawKey, models] of Object.entries(modelProvidersConfig)) {
        const authType = validateAuthTypeKey(rawKey);

        if (!authType) {
          debugLogger.warn(
            `Invalid authType key "${rawKey}" in modelProviders config. Expected one of: ${Object.values(AuthType).join(', ')}. Skipping.`,
          );
          continue;
        }

        this.registerAuthTypeModels(authType, models);
      }
    }
  }

  /**
   * Register models for an authType.
   * If multiple models have the same id, the first one takes precedence.
   */
  private registerAuthTypeModels(
    authType: AuthType,
    models: ModelConfig[],
  ): void {
    const modelMap = new Map<string, ResolvedModelConfig>();

    for (const config of models) {
      // Skip if a model with the same id is already registered (first one wins)
      if (modelMap.has(config.id)) {
        debugLogger.warn(
          `Duplicate model id "${config.id}" for authType "${authType}". Using the first registered config.`,
        );
        continue;
      }
      const resolved = this.resolveModelConfig(config, authType);
      modelMap.set(config.id, resolved);
    }

    this.modelsByAuthType.set(authType, modelMap);
  }

  /**
   * Get all models for a specific authType.
   * This is used by /model command to show only relevant models.
   */
  getModelsForAuthType(authType: AuthType): AvailableModel[] {
    const models = this.modelsByAuthType.get(authType);
    if (!models) return [];

    return Array.from(models.values()).map((model) => ({
      id: model.id,
      label: model.name,
      description: model.description,
      capabilities: model.capabilities,
      authType: model.authType,
      isVision: model.capabilities?.vision ?? false,
      contextWindowSize:
        model.generationConfig.contextWindowSize ?? tokenLimit(model.id),
      modalities:
        model.generationConfig.modalities ?? defaultModalities(model.id),
      baseUrl: model.baseUrl,
      envKey: model.envKey,
    }));
  }

  /**
   * Get model configuration by authType and modelId
   */
  getModel(
    authType: AuthType,
    modelId: string,
  ): ResolvedModelConfig | undefined {
    const models = this.modelsByAuthType.get(authType);
    return models?.get(modelId);
  }

  /**
   * Check if model exists for given authType
   */
  hasModel(authType: AuthType, modelId: string): boolean {
    const models = this.modelsByAuthType.get(authType);
    return models?.has(modelId) ?? false;
  }

  /**
   * Get default model for an authType.
   * Returns the first configured model.
   */
  getDefaultModelForAuthType(
    authType: AuthType,
  ): ResolvedModelConfig | undefined {
    const models = this.modelsByAuthType.get(authType);
    if (!models || models.size === 0) return undefined;
    return Array.from(models.values())[0];
  }

  /**
   * Resolve model config by applying defaults
   */
  private resolveModelConfig(
    config: ModelConfig,
    authType: AuthType,
  ): ResolvedModelConfig {
    this.validateModelConfig(config, authType);

    return {
      ...config,
      authType,
      name: config.name || config.id,
      baseUrl: config.baseUrl || this.getDefaultBaseUrl(authType),
      generationConfig: config.generationConfig ?? {},
      capabilities: config.capabilities || {},
    };
  }

  /**
   * Validate model configuration
   */
  private validateModelConfig(config: ModelConfig, authType: AuthType): void {
    if (!config.id) {
      throw new Error(
        `Model config in authType '${authType}' missing required field: id`,
      );
    }
  }

  /**
   * Reload models from updated configuration.
   * Clears existing models and re-registers from new config.
   */
  reloadModels(modelProvidersConfig?: ModelProvidersConfig): void {
    this.modelsByAuthType.clear();

    if (modelProvidersConfig) {
      for (const [rawKey, models] of Object.entries(modelProvidersConfig)) {
        const authType = validateAuthTypeKey(rawKey);

        if (!authType) {
          debugLogger.warn(
            `Invalid authType key "${rawKey}" in modelProviders config. Expected one of: ${Object.values(AuthType).join(', ')}. Skipping.`,
          );
          continue;
        }

        this.registerAuthTypeModels(authType, models);
      }
    }
  }
}
