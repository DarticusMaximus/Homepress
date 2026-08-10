import { describe, it, expect } from "vitest";
import { isPublicRoute, PUBLIC_ROUTES } from "../../lib/auth/routes";

describe("PUBLIC_ROUTES", () => {
  it("exposes login and health", () => {
    expect(PUBLIC_ROUTES).toContain("/login");
    expect(PUBLIC_ROUTES).toContain("/health");
  });
});

describe("isPublicRoute", () => {
  it("marks /login and /health as public", () => {
    expect(isPublicRoute("/login")).toBe(true);
    expect(isPublicRoute("/health")).toBe(true);
  });

  it("normalizes a single trailing slash", () => {
    expect(isPublicRoute("/login/")).toBe(true);
    expect(isPublicRoute("/health/")).toBe(true);
  });

  it("does not treat the root path as public", () => {
    expect(isPublicRoute("/")).toBe(false);
  });

  it("rejects arbitrary paths and empty string", () => {
    expect(isPublicRoute("/some/random/path")).toBe(false);
    expect(isPublicRoute("/dashboard")).toBe(false);
    expect(isPublicRoute("")).toBe(false);
  });

  it("requires exact normalized match (no prefix tricks)", () => {
    expect(isPublicRoute("/loginxyz")).toBe(false);
    expect(isPublicRoute("/login/inner")).toBe(false);
    expect(isPublicRoute("/healthcheck")).toBe(false);
    expect(isPublicRoute("/health/details")).toBe(false);
  });

  it("marks /rss/{id} (and trailing slash) as public (case 17)", () => {
    expect(isPublicRoute("/rss/some-id")).toBe(true);
    expect(isPublicRoute("/rss/some-id/")).toBe(true);
  });

  it("does not treat bare /rss as public", () => {
    expect(isPublicRoute("/rss")).toBe(false);
  });

  it("does not treat issue export as public (S3)", () => {
    expect(isPublicRoute("/api/issues/run-1/export")).toBe(false);
    expect(isPublicRoute("/api/issues/run-1/export/")).toBe(false);
    expect(PUBLIC_ROUTES).not.toContain("/api/issues/run-1/export");
  });
});
