import { describe, expect, it } from "vitest";
import { buildAdminIssueHref, buildIssueHref } from "@/components/issues/issue-url";

describe("buildIssueHref", () => {
  it("emits /issues/{runId} (case 1)", () => {
    expect(buildIssueHref("run-1")).toBe("/issues/run-1");
  });
});

describe("buildAdminIssueHref", () => {
  it("emits /admin/issues/{runId} (case 2)", () => {
    expect(buildAdminIssueHref("run-1")).toBe("/admin/issues/run-1");
  });
});
