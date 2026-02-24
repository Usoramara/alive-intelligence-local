/**
 * Local single-user helper.
 * Replaces Clerk auth for the local-first fork.
 * Returns a constant user ID for all requests.
 */

export const LOCAL_USER_ID = 'local-user';

export function getLocalUserId(): string {
  return LOCAL_USER_ID;
}
