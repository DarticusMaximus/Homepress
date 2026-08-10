import { describe, it, expect, vi } from "vitest";
import { parseRunFailedFeeds } from "../failed-feeds";

describe("parseRunFailedFeeds", () => {
  it("returns [] for an empty string", () => {
    expect(parseRunFailedFeeds("")).toEqual([]);
  });

  it("returns [] for a whitespace-only string", () => {
    expect(parseRunFailedFeeds("   ")).toEqual([]);
  });

  it("returns [] for invalid JSON and logs the error", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parseRunFailedFeeds("{not valid json")).toEqual([]);
    expect(errSpy).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  it("returns [] when JSON is not an array (object)", () => {
    expect(parseRunFailedFeeds(JSON.stringify({ feedUrl: "x" }))).toEqual([]);
  });

  it("parses a valid array into a typed FeedFailure list", () => {
    const json = JSON.stringify([
      {
        feedUrl: "https://a.example.com/feed",
        errorType: "HttpError",
        errorMessage: "HTTP 503",
        statusCode: 503,
      },
      {
        feedUrl: "https://b.example.com/feed",
        errorType: "NetworkError",
        errorMessage: "timeout",
      },
    ]);

    const result = parseRunFailedFeeds(json);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      feedUrl: "https://a.example.com/feed",
      errorType: "HttpError",
      errorMessage: "HTTP 503",
      statusCode: 503,
    });
    expect(result[1]).toEqual({
      feedUrl: "https://b.example.com/feed",
      errorType: "NetworkError",
      errorMessage: "timeout",
    });
  });

  it("coerces missing/invalid fields with best-effort defaults", () => {
    const json = JSON.stringify([
      { feedUrl: "https://a.example.com/feed" },
      { errorType: "ParseError", errorMessage: "bad xml" },
      null,
      "not-an-object",
      { feedUrl: 123, errorType: "TimeoutError", errorMessage: null },
    ]);

    const result = parseRunFailedFeeds(json);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      feedUrl: "https://a.example.com/feed",
      errorType: "NetworkError",
      errorMessage: "",
    });
    expect(result[1]).toEqual({
      feedUrl: "",
      errorType: "ParseError",
      errorMessage: "bad xml",
    });
    expect(result[2]).toEqual({
      feedUrl: "",
      errorType: "TimeoutError",
      errorMessage: "",
    });
  });

  it("preserves statusCode when it is a number", () => {
    const json = JSON.stringify([
      {
        feedUrl: "https://a.example.com/feed",
        errorType: "HttpError",
        errorMessage: "HTTP 404",
        statusCode: 404,
      },
    ]);

    const result = parseRunFailedFeeds(json);

    expect(result[0].statusCode).toBe(404);
  });

  it("omits statusCode when not a number", () => {
    const json = JSON.stringify([
      {
        feedUrl: "https://a.example.com/feed",
        errorType: "NetworkError",
        errorMessage: "dns fail",
        statusCode: "500",
      },
    ]);

    const result = parseRunFailedFeeds(json);

    expect(result[0].statusCode).toBeUndefined();
  });

  it("returns [] for an empty JSON array", () => {
    expect(parseRunFailedFeeds("[]")).toEqual([]);
  });
});
