import type { Models } from "node-appwrite";
import { requireUser } from "@/lib/auth/require-user";

/**
 * Thrown by `requireOperator()` when the authenticated user lacks the
 * `operator` label. Factory surfaces and issue export must reject with this
 * error before any side effect.
 */
export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * True when the Appwrite user carries the `operator` label. Missing or
 * undefined labels are treated as reader.
 */
export function isOperator(user: { labels?: string[] }): boolean {
  return user.labels?.includes("operator") ?? false;
}

/**
 * Fail-closed operator guard: returns the authenticated operator or throws
 * `UnauthorizedError` (no session) / `ForbiddenError` (reader). Wraps
 * `requireUser`; call as the first statement of every factory action.
 */
export async function requireOperator(): Promise<Models.User<Models.Preferences>> {
  const user = await requireUser();
  if (!isOperator(user)) {
    throw new ForbiddenError();
  }
  return user;
}
