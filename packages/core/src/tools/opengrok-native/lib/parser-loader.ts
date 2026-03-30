/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/* eslint-disable */
/**
 * Parser Loader with Caching
 *
 * Lazy-loads tree-sitter parsers on demand and caches them to avoid
 * repeated initialization overhead. Handles optional parsers gracefully.
 *
 * Ported from claude-context's ast-splitter.ts parser loading pattern.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ============================================================================
// Bun Binary Support
// ============================================================================

// In a Bun-compiled binary, import.meta.url points to /$bunfs/root/... (virtual FS).
// Native .node addons must be loaded from the real filesystem alongside the binary.
// Bun's createRequire in compiled binaries ignores the anchor path, so we need
// to directly require from absolute paths to the sidecar node_modules.
const isBunBinary =
  typeof (globalThis as any).Bun !== 'undefined' &&
  (import.meta.url.includes('/$bunfs/') || import.meta.url.includes('bun:'));

function getBinaryRequire(): NodeRequire {
  if (isBunBinary) {
    const binaryDir = dirname(process.execPath);
    const nodeModulesDir = join(binaryDir, 'node_modules');

    // Return a require-like function that resolves from the sidecar node_modules
    const bunRequire = ((id: string) => {
      // For bare specifiers (package names), resolve from sidecar node_modules
      if (!id.startsWith('.') && !id.startsWith('/')) {
        const pkgDir = join(nodeModulesDir, id);
        try {
          // Read package.json to find the entry point
          const fs = require('fs');
          const pkgJson = JSON.parse(
            fs.readFileSync(join(pkgDir, 'package.json'), 'utf8'),
          );
          const main = pkgJson.main || 'index.js';
          const entryPoint = join(pkgDir, main);
          // If main points to a directory, append index.js
          try {
            const stat = fs.statSync(entryPoint);
            if (stat.isDirectory()) {
              return require(join(entryPoint, 'index.js'));
            }
          } catch {
            // Not a directory or doesn't exist, try as file
          }
          return require(entryPoint);
        } catch (e) {
          // Fall through to standard require
        }
      }
      return require(id);
    }) as unknown as NodeRequire;

    return bunRequire;
  }
  return createRequire(import.meta.url);
}

// ============================================================================
// Parser Cache
// ============================================================================

interface ParserCacheEntry {
  parser: any | null; // Tree-sitter Parser instance or null if unavailable
  language: any | null; // Language grammar module or null if unavailable
  available: boolean; // Whether the parser loaded successfully
  error?: string; // Error message if loading failed
}

const parserCache: Map<string, ParserCacheEntry> = new Map();

// ============================================================================
// Parser Loading
// ============================================================================

/**
 * Load a tree-sitter parser for the specified language
 *
 * This function:
 * 1. Checks the cache first to avoid re-initializing
 * 2. Attempts to load Parser and the language-specific grammar
 * 3. Caches the result (including failures) to avoid retry overhead
 * 4. Handles optional parsers (like Perl) gracefully
 *
 * @param language - Language identifier ("cpp", "python", "perl")
 * @returns Parser instance and language grammar, or null if unavailable
 */
export function loadTreeSitterParser(language: string): {
  parser: any;
  language: any;
} | null {
  // Normalize language name
  const lang = language.toLowerCase();

  // Check cache first
  const cached = parserCache.get(lang);
  if (cached) {
    return cached.available
      ? { parser: cached.parser, language: cached.language }
      : null;
  }

  // Try to load Parser and language grammar
  try {
    const require = getBinaryRequire();

    // Load base Parser (tree-sitter package)
    let Parser: any;
    try {
      Parser = require('tree-sitter');
    } catch (e) {
      const error = `tree-sitter not available: ${(e as Error).message}`;
      console.error(`[parser-loader] ${error}`);
      parserCache.set(lang, {
        parser: null,
        language: null,
        available: false,
        error,
      });
      return null;
    }

    // Load language-specific grammar
    let languageGrammar: any;
    const grammarModule = getGrammarModule(lang);

    if (!grammarModule) {
      const error = `No grammar module defined for language: ${lang}`;
      console.error(`[parser-loader] ${error}`);
      parserCache.set(lang, {
        parser: null,
        language: null,
        available: false,
        error,
      });
      return null;
    }

    try {
      languageGrammar = require(grammarModule);
    } catch (e) {
      const error = `${grammarModule} not available: ${(e as Error).message}`;

      // For optional parsers (like Perl), this is expected - don't spam logs
      if (lang === 'perl') {
        console.warn(
          `[parser-loader] Optional parser ${grammarModule} not installed (this is OK)`,
        );
      } else {
        console.error(`[parser-loader] ${error}`);
      }

      parserCache.set(lang, {
        parser: null,
        language: null,
        available: false,
        error,
      });
      return null;
    }

    // Create parser instance
    const parser = new Parser();
    parser.setLanguage(languageGrammar);

    // Cache successful result
    parserCache.set(lang, {
      parser,
      language: languageGrammar,
      available: true,
    });

    console.log(`[parser-loader] Successfully loaded parser for ${lang}`);
    return { parser, language: languageGrammar };
  } catch (e) {
    const error = `Failed to initialize parser for ${lang}: ${(e as Error).message}`;
    console.error(`[parser-loader] ${error}`);
    parserCache.set(lang, {
      parser: null,
      language: null,
      available: false,
      error,
    });
    return null;
  }
}

/**
 * Get the npm package name for a language's tree-sitter grammar
 */
function getGrammarModule(language: string): string | null {
  switch (language) {
    case 'cpp':
    case 'cxx':
    case 'c++':
      return 'tree-sitter-cpp';

    case 'c':
      return 'tree-sitter-c';

    case 'python':
    case 'py':
      return 'tree-sitter-python';

    case 'perl':
    case 'pl':
      return '@ganezdragon/tree-sitter-perl';

    default:
      return null;
  }
}

/**
 * Check if a parser is available without actually loading it
 * (uses cache if already attempted)
 */
export function isParserAvailable(language: string): boolean {
  const lang = language.toLowerCase();
  const cached = parserCache.get(lang);

  if (cached) {
    return cached.available;
  }

  // Haven't tried loading yet - attempt it
  const result = loadTreeSitterParser(lang);
  return result !== null;
}

/**
 * Clear the parser cache (useful for testing)
 */
export function clearParserCache(): void {
  parserCache.clear();
}

/**
 * Get cache statistics (for debugging/monitoring)
 */
export function getParserCacheStats(): {
  total: number;
  available: number;
  unavailable: number;
  languages: string[];
} {
  const available = Array.from(parserCache.values()).filter(
    (e) => e.available,
  ).length;
  const unavailable = parserCache.size - available;
  const languages = Array.from(parserCache.keys());

  return {
    total: parserCache.size,
    available,
    unavailable,
    languages,
  };
}
