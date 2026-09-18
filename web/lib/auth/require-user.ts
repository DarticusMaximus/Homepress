import type { Models } from "node-appwrite";
import { getAuthenticatedUser } from "@/lib/auth/session";

/**
 * Thrown by `requireUser()` when no valid session exists. Every exported
 * server action calls `requireUser()` as its first statement, outside any
 * try/catch — unauthenticated invocation must always reject with this error
 * before any side effect.
 */
export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Fail-closed auth guard for server actions: returns the authenticated user
 * or throws `UnauthorizedError`. Wraps the authoritative session check
 * (`getAuthenticatedUser`); call as the first statement of every action.
 */
export async function requireUser(): Promise<Models.User<Models.Preferences>> {
  const user = await getAuthenticatedUser();
  if (!user) {
    throw new UnauthorizedError();
  }
  return user;
}
