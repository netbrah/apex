/* eslint-disable */
// @ts-nocheck
/**
 * Cache shim for vendored OpenGrok-native tools.
 *
 * Provides a simple in-memory cache with the same API surface
 * as the full opengrokmcp cache module.
 */

class SimpleCache<T> {
  private cache = new Map<string, T>();
  private maxSize: number;

  constructor(maxSize: number = 500) {
    this.maxSize = maxSize;
  }

  get(key: string): T | undefined {
    return this.cache.get(key);
  }

  set(key: string, value: T): void {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

export interface CallerInfo {
  name: string;
  file: string;
  line: number;
}

export interface SymbolDefinition {
  file: string;
  line: number;
  kind?: string;
}

export const symbolDefinitionCache = new SimpleCache<SymbolDefinition>(200);
export const callersCache = new SimpleCache<CallerInfo[]>(200);
export const fileContentCache = new SimpleCache<string>(500);

export const cacheKeys = {
  symbol: (project: string, symbol: string) => `${project}:def:${symbol}`,
  callers: (project: string, symbol: string) => `${project}:callers:${symbol}`,
  file: (project: string, file: string) => `${project}:file:${file}`,
};
