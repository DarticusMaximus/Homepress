import { describe, it, expect } from "vitest";
import { mapLoginError } from "../../lib/auth/login-errors";

const CREDENTIALS_MESSAGE = "Invalid email or password";
const GENERIC_MESSAGE = "Login failed. Please try again.";

describe("mapLoginError", () => {
  describe("credentials failures -> credentials message", () => {
    it("maps a real Appwrite credentials failure (401 + type user_invalid_credentials)", () => {
      const err = {
        code: 401,
        type: "user_invalid_credentials",
        message: "Invalid credentials. Please check the requested credentials",
      };
      expect(mapLoginError(err)).toBe(CREDENTIALS_MESSAGE);
    });

    it("maps an error whose message includes `user_invalid_credentials`", () => {
      const err = { message: "Appwrite: user_invalid_credentials" };
      expect(mapLoginError(err)).toBe(CREDENTIALS_MESSAGE);
    });

    it("maps an Error whose message includes `invalid credentials` (case-insensitive)", () => {
      expect(mapLoginError(new Error("INVALID CREDENTIALS"))).toBe(CREDENTIALS_MESSAGE);
      expect(mapLoginError(new Error("Invalid Credentials"))).toBe(CREDENTIALS_MESSAGE);
      expect(mapLoginError(new Error("something invalid credentials something"))).toBe(
        CREDENTIALS_MESSAGE,
      );
    });

    it("maps an error carrying type user_invalid_credentials without a code", () => {
      const err = { type: "user_invalid_credentials", message: "nope" };
      expect(mapLoginError(err)).toBe(CREDENTIALS_MESSAGE);
    });

    it("maps an error with type USER_INVALID_CREDENTIALS (case-insensitive)", () => {
      const err = { type: "USER_INVALID_CREDENTIALS" };
      expect(mapLoginError(err)).toBe(CREDENTIALS_MESSAGE);
    });
  });

  describe("Appwrite 401 backend errors -> generic message (regression cases)", () => {
    it("maps a user_unauthorized 401 (misconfigured/expired API key) to the generic message", () => {
      const err = {
        code: 401,
        type: "user_unauthorized",
        message: "The current user is not authorized to perform the requested action.",
      };
      expect(mapLoginError(err)).toBe(GENERIC_MESSAGE);
    });

    it("maps a bare 401 with no credentials type/message to the generic message", () => {
      const err = { code: 401, message: "some other 401" };
      expect(mapLoginError(err)).toBe(GENERIC_MESSAGE);
    });

    it("maps a 401 with an unrelated type to the generic message", () => {
      const err = { code: 401, type: "user_unauthorized", message: "Unauthorized" };
      expect(mapLoginError(err)).toBe(GENERIC_MESSAGE);
    });
  });

  describe("everything else -> generic message", () => {
    it("maps a network-style Error", () => {
      expect(mapLoginError(new Error("network blew up"))).toBe(GENERIC_MESSAGE);
    });

    it("maps a generic Error with an unrelated message", () => {
      expect(mapLoginError(new Error("something else went wrong"))).toBe(GENERIC_MESSAGE);
    });

    it("maps a string", () => {
      expect(mapLoginError("a plain string")).toBe(GENERIC_MESSAGE);
    });

    it("maps null", () => {
      expect(mapLoginError(null)).toBe(GENERIC_MESSAGE);
    });

    it("maps undefined", () => {
      expect(mapLoginError(undefined)).toBe(GENERIC_MESSAGE);
    });

    it("maps a plain object without code/message", () => {
      expect(mapLoginError({ foo: "bar" })).toBe(GENERIC_MESSAGE);
    });

    it("maps a number", () => {
      expect(mapLoginError(42)).toBe(GENERIC_MESSAGE);
    });
  });

  describe("robustness contract", () => {
    it("never throws and never returns undefined even when property access throws", () => {
      const hostile = {
        get message(): string {
          throw new Error("getter trap");
        },
        get code(): number {
          throw new Error("getter trap");
        },
      };
      expect(() => mapLoginError(hostile)).not.toThrow();
      const result = mapLoginError(hostile);
      expect(result).toBe(GENERIC_MESSAGE);
    });

    it("always returns a non-empty string for every input in a fuzz batch", () => {
      const inputs: unknown[] = [
        null,
        undefined,
        "",
        0,
        false,
        {},
        [],
        { code: 401 },
        { message: "user_invalid_credentials" },
        new Error("x"),
        Symbol("s"),
      ];
      for (const input of inputs) {
        const result = mapLoginError(input);
        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThan(0);
      }
    });
  });
});
