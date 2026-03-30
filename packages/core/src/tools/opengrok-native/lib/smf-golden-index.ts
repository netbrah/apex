/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Golden-index shim for native core tools.
 *
 * We intentionally return undefined and fall back to OpenGrok lookup+parse.
 */

export async function getSmfTable(_name: string): Promise<undefined> {
  return undefined;
}
