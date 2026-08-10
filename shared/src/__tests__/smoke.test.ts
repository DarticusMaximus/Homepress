import { describe, it, expect } from "vitest";
import { APP_NAME } from "../index";

describe("smoke", () => {
  it("runs basic assertions", () => {
    expect(1 + 1).toBe(2);
  });

  it("imports a real symbol from @newsletter/shared", () => {
    expect(APP_NAME).toBe("Homepress");
  });
});
