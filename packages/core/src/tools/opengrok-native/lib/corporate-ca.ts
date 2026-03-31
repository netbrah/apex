/* eslint-disable */
// @ts-nocheck
/**
 * Corporate CA certificate loader for vendored OpenGrok-native tools.
 */

import fs from 'fs';
import path from 'path';

let _corporateCa: Buffer | undefined | null = null;

/**
 * Load the corporate CA bundle.
 * Cached after first call.
 */
export function getCorporateCa(): Buffer | undefined {
  if (_corporateCa === null) {
    const envCa = process.env.NODE_EXTRA_CA_CERTS;
    if (envCa) {
      try {
        _corporateCa = fs.readFileSync(envCa);
      } catch {
        _corporateCa = undefined;
      }
    } else {
      _corporateCa = undefined;
    }
  }
  return _corporateCa || undefined;
}
