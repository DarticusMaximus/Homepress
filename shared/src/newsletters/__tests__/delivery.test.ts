import { describe, it, expect } from "vitest";

import { RECIPIENT_EMAIL_MAX_LENGTH, RECIPIENT_LIST_MAX } from "../../schema/declarations";
import { NewsletterRepositoryError } from "../types";
import {
  isValidEmailAddress,
  normalizeEmailAddress,
  resolveDeliveryFields,
} from "../delivery";

function expectValidationError(fn: () => unknown): NewsletterRepositoryError {
  try {
    fn();
    throw new Error("Expected NewsletterRepositoryError to be thrown");
  } catch (err) {
    expect(err).toBeInstanceOf(NewsletterRepositoryError);
    const repoErr = err as NewsletterRepositoryError;
    expect(repoErr.code).toBe("validation");
    return repoErr;
  }
}

describe("normalizeEmailAddress", () => {
  it("trims and lowercases an address", () => {
    expect(normalizeEmailAddress("  A@B.Com  ")).toBe("a@b.com");
  });
});

describe("isValidEmailAddress", () => {
  it("accepts a simple local@domain address", () => {
    expect(isValidEmailAddress("user@example.com")).toBe(true);
  });

  it("rejects not-an-email, @nodomain, and whitespace addresses", () => {
    expect(isValidEmailAddress("not-an-email")).toBe(false);
    expect(isValidEmailAddress("@nodomain")).toBe(false);
    expect(isValidEmailAddress("spaces ok@x.com")).toBe(false);
  });

  it("rejects addresses over RECIPIENT_EMAIL_MAX_LENGTH after normalize", () => {
    const local = "a".repeat(RECIPIENT_EMAIL_MAX_LENGTH);
    const overLength = `${local}@x.com`;
    expect(overLength.length).toBeGreaterThan(RECIPIENT_EMAIL_MAX_LENGTH);
    expect(isValidEmailAddress(overLength)).toBe(false);
  });
});

describe("resolveDeliveryFields", () => {
  it("normalizes, lowercases, and dedupes case-insensitively (keep first)", () => {
    const resolved = resolveDeliveryFields({
      recipientEmails: ["  A@B.com  ", "a@b.com", "Other@Example.COM"],
      autoEmail: false,
      autoRss: false,
    });

    expect(resolved.recipientEmails).toEqual(["a@b.com", "other@example.com"]);
    expect(resolved.autoEmail).toBe(false);
    expect(resolved.autoRss).toBe(false);
  });

  it("accepts two good addresses with both toggles false", () => {
    const resolved = resolveDeliveryFields({
      recipientEmails: ["alice@example.com", "bob@example.org"],
      autoEmail: false,
      autoRss: false,
    });

    expect(resolved).toEqual({
      recipientEmails: ["alice@example.com", "bob@example.org"],
      autoEmail: false,
      autoRss: false,
    });
  });

  it("rejects invalid recipient emails with Invalid recipient email", () => {
    for (const bad of ["not-an-email", "@nodomain", "spaces ok@x.com"] as const) {
      const err = expectValidationError(() =>
        resolveDeliveryFields({
          recipientEmails: [bad],
          autoEmail: false,
          autoRss: false,
        }),
      );
      expect(err.message).toBe("Invalid recipient email");
    }

    const local = "a".repeat(RECIPIENT_EMAIL_MAX_LENGTH);
    const overLength = `${local}@x.com`;
    const err = expectValidationError(() =>
      resolveDeliveryFields({
        recipientEmails: [overLength],
        autoEmail: false,
        autoRss: false,
      }),
    );
    expect(err.message).toBe("Invalid recipient email");
  });

  it("rejects more than RECIPIENT_LIST_MAX addresses and names the max", () => {
    const addresses = Array.from(
      { length: RECIPIENT_LIST_MAX + 1 },
      (_, i) => `user${i}@example.com`,
    );
    expect(addresses).toHaveLength(21);

    const err = expectValidationError(() =>
      resolveDeliveryFields({
        recipientEmails: addresses,
        autoEmail: false,
        autoRss: false,
      }),
    );
    expect(err.message).toContain(String(RECIPIENT_LIST_MAX));
    expect(err.message).toContain("20");
  });

  it("requires at least one recipient when auto-email is enabled", () => {
    const err = expectValidationError(() =>
      resolveDeliveryFields({
        recipientEmails: [],
        autoEmail: true,
        autoRss: false,
      }),
    );
    expect(err.message).toBe(
      "At least one recipient is required when auto-email is enabled",
    );
  });

  it("accepts auto-RSS alone with an empty recipient list", () => {
    const resolved = resolveDeliveryFields({
      recipientEmails: [],
      autoEmail: false,
      autoRss: true,
    });

    expect(resolved).toEqual({
      recipientEmails: [],
      autoEmail: false,
      autoRss: true,
    });
  });

  it("rejects non-boolean autoEmail and autoRss toggles", () => {
    expectValidationError(() =>
      resolveDeliveryFields({
        recipientEmails: [],
        autoEmail: "true" as unknown as boolean,
        autoRss: false,
      }),
    );
    expectValidationError(() =>
      resolveDeliveryFields({
        recipientEmails: [],
        autoEmail: false,
        autoRss: 1 as unknown as boolean,
      }),
    );
    expectValidationError(() =>
      resolveDeliveryFields({
        recipientEmails: [],
        autoEmail: null as unknown as boolean,
        autoRss: false,
      }),
    );
  });

  it("drops whitespace-only chips before length and validity checks", () => {
    const resolved = resolveDeliveryFields({
      recipientEmails: ["  ", "\t", "", "keep@example.com", "   "],
      autoEmail: false,
      autoRss: false,
    });

    expect(resolved.recipientEmails).toEqual(["keep@example.com"]);

    // Blanks do not count toward the max — 20 real + blanks stays under the cap.
    const twenty = Array.from({ length: RECIPIENT_LIST_MAX }, (_, i) => `u${i}@ex.com`);
    const withBlanks = resolveDeliveryFields({
      recipientEmails: ["   ", ...twenty, "\t", ""],
      autoEmail: false,
      autoRss: false,
    });
    expect(withBlanks.recipientEmails).toHaveLength(RECIPIENT_LIST_MAX);
  });
});
