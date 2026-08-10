import { describe, it, expect, vi } from "vitest";

import { FeedRepositoryError } from "../types";
import { validateFeedName, validateFeedUrl, validateFeedNotes } from "../validation";

function expectValidationError(fn: () => unknown): FeedRepositoryError {
  try {
    fn();
    throw new Error("Expected FeedRepositoryError to be thrown");
  } catch (err) {
    expect(err).toBeInstanceOf(FeedRepositoryError);
    const repoErr = err as FeedRepositoryError;
    expect(repoErr.code).toBe("validation");
    return repoErr;
  }
}

async function expectUrlValidationError(fn: () => Promise<unknown>): Promise<FeedRepositoryError> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof FeedRepositoryError) {
      expect(err.code).toBe("validation");
      return err;
    }
    throw err;
  }
  throw new Error("Expected FeedRepositoryError to be thrown");
}

function publicResolver() {
  return vi.fn(async (_host: string) => ["93.184.216.34"]);
}

describe("validateFeedName", () => {
  it("accepts a non-empty name within the 255-char limit", () => {
    const name = "a".repeat(255);
    expect(validateFeedName(name)).toBe(name);
  });

  it("trims leading and trailing whitespace", () => {
    expect(validateFeedName("  My Feed  ")).toBe("My Feed");
  });

  it("rejects empty string", () => {
    expectValidationError(() => validateFeedName(""));
  });

  it("rejects whitespace-only name", () => {
    expectValidationError(() => validateFeedName("   \t  "));
  });

  it("rejects names longer than 255 characters after trim", () => {
    expectValidationError(() => validateFeedName("a".repeat(256)));
  });
});

describe("validateFeedUrl", () => {
  it("accepts valid http and https URLs within the 2048-char limit", async () => {
    const resolver = publicResolver();
    expect(await validateFeedUrl("http://example.com/feed", { resolver })).toBe(
      "http://example.com/feed",
    );
    expect(await validateFeedUrl("https://example.com/feed", { resolver })).toBe(
      "https://example.com/feed",
    );
    const longPath = "https://example.com/" + "a".repeat(2020);
    expect(await validateFeedUrl(longPath, { resolver })).toBe(longPath);
  });

  it("trims leading and trailing whitespace without rewriting the URL", async () => {
    const resolver = publicResolver();
    expect(await validateFeedUrl("  https://example.com/feed  ", { resolver })).toBe(
      "https://example.com/feed",
    );
  });

  it("treats trailing-slash variants as different URLs (trim-only, no canonicalization)", async () => {
    const resolver = publicResolver();
    const withSlash = await validateFeedUrl("https://example.com/feed/", { resolver });
    const withoutSlash = await validateFeedUrl("https://example.com/feed", { resolver });
    expect(withSlash).toBe("https://example.com/feed/");
    expect(withoutSlash).toBe("https://example.com/feed");
    expect(withSlash).not.toBe(withoutSlash);
  });

  it("accepts a normal public feed URL", async () => {
    const resolver = publicResolver();
    expect(await validateFeedUrl("https://example.com/feed.xml", { resolver })).toBe(
      "https://example.com/feed.xml",
    );
    expect(resolver).toHaveBeenCalledWith("example.com");
  });

  it("rejects empty URL", async () => {
    const err = await expectUrlValidationError(() => validateFeedUrl(""));
    expect(err.message).toBe("URL is required");
  });

  it("rejects whitespace-only URL", async () => {
    const err = await expectUrlValidationError(() => validateFeedUrl("   "));
    expect(err.message).toBe("URL is required");
  });

  it("rejects ftp: scheme without a DNS lookup", async () => {
    const resolver = publicResolver();
    const err = await expectUrlValidationError(() =>
      validateFeedUrl("ftp://example.com/feed", { resolver }),
    );
    expect(err.message).toBe("URL must use http or https");
    expect(resolver).not.toHaveBeenCalled();
  });

  it("rejects relative URLs without a DNS lookup", async () => {
    const resolver = publicResolver();
    await expectUrlValidationError(() => validateFeedUrl("/feed", { resolver }));
    await expectUrlValidationError(() => validateFeedUrl("example.com/feed", { resolver }));
    expect(resolver).not.toHaveBeenCalled();
  });

  it("rejects garbage / unparseable URLs", async () => {
    const resolver = publicResolver();
    const err = await expectUrlValidationError(() => validateFeedUrl("not a url", { resolver }));
    expect(err.message).toBe("URL must be a valid http or https address");
    await expectUrlValidationError(() => validateFeedUrl("://missing-scheme", { resolver }));
    expect(resolver).not.toHaveBeenCalled();
  });

  it("rejects URLs longer than 2048 characters after trim", async () => {
    const err = await expectUrlValidationError(() =>
      validateFeedUrl("https://example.com/" + "a".repeat(2048)),
    );
    expect(err.message).toBe("URL must be 2048 characters or less");
  });

  it("rejects loopback IPv4 literals with no DNS lookup", async () => {
    const resolver = publicResolver();
    const err = await expectUrlValidationError(() =>
      validateFeedUrl("http://127.0.0.1/", { resolver }),
    );
    expect(err.message).toMatch(/publicly routable/);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("rejects cloud-metadata link-local addresses with no DNS lookup", async () => {
    const resolver = publicResolver();
    const err = await expectUrlValidationError(() =>
      validateFeedUrl("http://169.254.169.254/latest/meta-data/", { resolver }),
    );
    expect(err.message).toMatch(/publicly routable/);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("rejects RFC1918 private addresses with no DNS lookup", async () => {
    const resolver = publicResolver();
    const err = await expectUrlValidationError(() =>
      validateFeedUrl("http://10.0.0.1/", { resolver }),
    );
    expect(err.message).toMatch(/publicly routable/);
    await expectUrlValidationError(() => validateFeedUrl("http://192.168.1.1/feed", { resolver }));
    await expectUrlValidationError(() => validateFeedUrl("http://172.16.0.1/feed", { resolver }));
    expect(resolver).not.toHaveBeenCalled();
  });

  it("rejects IPv6 loopback literals with no DNS lookup", async () => {
    const resolver = publicResolver();
    const err = await expectUrlValidationError(() =>
      validateFeedUrl("http://[::1]/", { resolver }),
    );
    expect(err.message).toMatch(/publicly routable/);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("rejects IPv4-mapped IPv6 loopback literals", async () => {
    const resolver = publicResolver();
    await expectUrlValidationError(() =>
      validateFeedUrl("http://[::ffff:127.0.0.1]/feed", { resolver }),
    );
    expect(resolver).not.toHaveBeenCalled();
  });

  it("rejects a public hostname that DNS-resolves into a private range", async () => {
    const resolver = vi.fn(async (_host: string) => ["10.0.0.1"]);
    const err = await expectUrlValidationError(() =>
      validateFeedUrl("https://internal.example.com/feed", { resolver }),
    );
    expect(err.message).toMatch(/publicly routable/);
    expect(resolver).toHaveBeenCalledWith("internal.example.com");
  });
});

describe("validateFeedNotes", () => {
  it("accepts notes within the 2000-char limit", () => {
    const notes = "n".repeat(2000);
    expect(validateFeedNotes(notes)).toBe(notes);
  });

  it("trims leading and trailing whitespace", () => {
    expect(validateFeedNotes("  optional context  ")).toBe("optional context");
  });

  it("returns empty string for undefined, empty, or whitespace-only notes", () => {
    expect(validateFeedNotes(undefined)).toBe("");
    expect(validateFeedNotes("")).toBe("");
    expect(validateFeedNotes("   ")).toBe("");
  });

  it("rejects notes longer than 2000 characters after trim", () => {
    expectValidationError(() => validateFeedNotes("n".repeat(2001)));
  });
});
