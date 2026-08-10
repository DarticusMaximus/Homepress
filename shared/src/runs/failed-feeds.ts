import type { FeedFailure, FeedErrorType } from "../pipeline/types";

const VALID_ERROR_TYPES: readonly FeedErrorType[] = [
  "HttpError",
  "NetworkError",
  "TimeoutError",
  "ParseError",
  "BlockedError",
];

function coerceErrorType(value: unknown): FeedErrorType {
  return VALID_ERROR_TYPES.includes(value as FeedErrorType)
    ? (value as FeedErrorType)
    : "NetworkError";
}

/**
 * Parse a run's `failedFeeds` JSON string back into a typed `FeedFailure[]`.
 *
 * - Empty / whitespace-only string → `[]`.
 * - Invalid JSON → `[]` (logs the parse error).
 * - Valid JSON array → best-effort typed list; non-object entries are dropped,
 *   missing fields default to `""` / `"NetworkError"`, and `statusCode` is kept
 *   only when it is a number.
 */
export function parseRunFailedFeeds(failedFeedsJson: string): FeedFailure[] {
  if (!failedFeedsJson || failedFeedsJson.trim().length === 0) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(failedFeedsJson);
  } catch {
    console.error({
      phase: "parse-run-failed-feeds",
      message: "Invalid JSON in run failedFeeds field, returning []",
    });
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
    .map((item) => {
      const failure: FeedFailure = {
        feedUrl: typeof item.feedUrl === "string" ? item.feedUrl : "",
        errorType: coerceErrorType(item.errorType),
        errorMessage: typeof item.errorMessage === "string" ? item.errorMessage : "",
      };
      if (typeof item.statusCode === "number") {
        failure.statusCode = item.statusCode;
      }
      return failure;
    });
}
