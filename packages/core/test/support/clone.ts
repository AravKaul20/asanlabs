/**
 * Deep clone for plain test data.
 *
 * `structuredClone` is a host global, and core's tsconfig deliberately has no
 * DOM or Node types, so it is not declared here. Test fixtures are plain JSON
 * anyway.
 */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
