/* eslint-disable */
// @ts-nocheck
/**
 * Batch execute utility for vendored OpenGrok-native tools.
 *
 * Executes an array of async operations in parallel using Promise.all.
 */

export async function batchExecute<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  return Promise.all(items.map(fn));
}
