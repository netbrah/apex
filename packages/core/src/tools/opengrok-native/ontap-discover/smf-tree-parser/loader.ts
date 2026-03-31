/**
 * Parser loader - imports the generated Peggy parser
 *
 * This module handles loading the generated parser and provides
 * a synchronous parse function.
 */

// @ts-expect-error - generated file, no type declarations
import * as generatedParser from './parser.generated.js';
import { setParser } from './index.js';

// Initialize the parser on module load
setParser(generatedParser);

export { generatedParser };
