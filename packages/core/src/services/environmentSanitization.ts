/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Environment variable sanitization for sandboxed execution.
 *
 * Strips env vars that match secret patterns (e.g., *_KEY, *_SECRET, *_TOKEN)
 * unless they are explicitly allowlisted. This prevents credential leakage
 * to sandboxed tool processes.
 */

/**
 * Patterns (case-insensitive suffix match) that identify secret env vars.
 * Any env var whose name ends with one of these suffixes is considered sensitive.
 */
export const SECRET_ENV_PATTERNS: readonly string[] = [
  '_KEY',
  '_SECRET',
  '_TOKEN',
  '_PASSWORD',
  '_CREDENTIAL',
  '_CREDENTIALS',
  '_API_KEY',
  '_APIKEY',
  '_AUTH',
  '_PRIVATE_KEY',
] as const;

/**
 * Exact env var names that are always considered secret regardless of pattern.
 */
export const SECRET_ENV_EXACT: ReadonlySet<string> = new Set([
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'NPM_TOKEN',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'DATABASE_URL',
  'REDIS_URL',
  'MONGO_URI',
  'MONGODB_URI',
  'ENCRYPTION_KEY',
  'SIGNING_KEY',
  'JWT_SECRET',
  'SESSION_SECRET',
  'COOKIE_SECRET',
]);

/**
 * Env vars that are always safe to pass through, even if they match
 * a secret pattern. These are required for correct tool execution.
 */
export const DEFAULT_ALLOWLIST: ReadonlySet<string> = new Set([
  // Node / system essentials
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TMPDIR',
  'TEMP',
  'TMP',
  'XDG_RUNTIME_DIR',
  'XDG_DATA_HOME',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  // Node.js
  'NODE_ENV',
  'NODE_PATH',
  'NODE_OPTIONS',
  'NODE_EXTRA_CA_CERTS',
  'NPM_CONFIG_PREFIX',
  'NVM_DIR',
  // Build / dev tooling
  'CI',
  'DEBUG',
  'FORCE_COLOR',
  'NO_COLOR',
  'COLORTERM',
  'COLUMNS',
  'LINES',
  'EDITOR',
  'VISUAL',
  'PAGER',
  'GIT_PAGER',
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL',
  // Apex Code markers
  'APEX_CODE',
  // Windows essentials
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMDATA',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'USERNAME',
  'OS',
  'PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS',
  'SystemDrive',
  // Python
  'PYTHONPATH',
  'VIRTUAL_ENV',
  'CONDA_DEFAULT_ENV',
  'CONDA_PREFIX',
  // macOS
  'DYLD_LIBRARY_PATH',
  'DYLD_FALLBACK_LIBRARY_PATH',
  // Linux
  'LD_LIBRARY_PATH',
  'LD_PRELOAD',
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'DBUS_SESSION_BUS_ADDRESS',
]);

/**
 * Configuration for environment variable sanitization.
 */
export interface EnvironmentSanitizationConfig {
  /** Patterns (suffixes) that identify secret env vars. */
  secretPatterns: readonly string[];
  /** Exact env var names that are always secret. */
  secretExact: ReadonlySet<string>;
  /** Env vars that are always allowed through, even if they match a pattern. */
  allowlist: ReadonlySet<string>;
  /** Additional env vars to allowlist (merged with default allowlist). */
  additionalAllowlist?: ReadonlySet<string>;
}

/**
 * Returns the secure default sanitization config, optionally merged with overrides.
 */
export function getSecureSanitizationConfig(
  overrides?: Partial<EnvironmentSanitizationConfig>,
): EnvironmentSanitizationConfig {
  const config: EnvironmentSanitizationConfig = {
    secretPatterns: overrides?.secretPatterns ?? SECRET_ENV_PATTERNS,
    secretExact: overrides?.secretExact ?? SECRET_ENV_EXACT,
    allowlist: overrides?.allowlist ?? DEFAULT_ALLOWLIST,
    additionalAllowlist: overrides?.additionalAllowlist,
  };
  return config;
}

/**
 * Returns true if the given env var name matches a secret pattern.
 */
export function isSecretEnvVar(
  name: string,
  config: EnvironmentSanitizationConfig,
): boolean {
  const upperName = name.toUpperCase();

  // Check allowlist first - allowlisted vars are never secret
  if (config.allowlist.has(name) || config.allowlist.has(upperName)) {
    return false;
  }
  if (
    config.additionalAllowlist &&
    (config.additionalAllowlist.has(name) ||
      config.additionalAllowlist.has(upperName))
  ) {
    return false;
  }

  // Check exact matches
  if (config.secretExact.has(name) || config.secretExact.has(upperName)) {
    return true;
  }

  // Check suffix patterns
  return config.secretPatterns.some((pattern) =>
    upperName.endsWith(pattern.toUpperCase()),
  );
}

/**
 * Sanitizes a set of environment variables by removing those that match
 * secret patterns, unless explicitly allowlisted.
 *
 * @returns A new env object with secret vars stripped.
 */
export function sanitizeEnvironment(
  env: NodeJS.ProcessEnv,
  config?: Partial<EnvironmentSanitizationConfig>,
): NodeJS.ProcessEnv {
  const fullConfig = getSecureSanitizationConfig(config);
  const sanitized: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (!isSecretEnvVar(key, fullConfig)) {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
