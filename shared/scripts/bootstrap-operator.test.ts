import { describe, expect, it } from "vitest";
import { existingOperatorPlan } from "./bootstrap-operator.mjs";

describe("existingOperatorPlan (S7)", () => {
  it("refuses to label when the listed email does not match", () => {
    const plan = existingOperatorPlan(
      { $id: "user-1", email: "other@example.com", labels: [] },
      "ada@example.com",
    );

    expect(plan.kind).toBe("mismatch");
    if (plan.kind !== "mismatch") return;
    expect(plan.message).toMatch(/does not match HOMEPRESS_OPERATOR_EMAIL/i);
    expect(plan.message).toMatch(/ada@example.com/);
    expect(plan.message).toMatch(/other@example.com/);
    expect(plan).not.toHaveProperty("labels");
  });

  it("compares emails case-insensitively against the already-lowercased env value", () => {
    const plan = existingOperatorPlan(
      { $id: "user-1", email: "Ada@Example.COM", labels: [] },
      "ada@example.com",
    );

    expect(plan.kind).toBe("label");
    if (plan.kind !== "label") return;
    expect(plan.labels).toEqual(["operator"]);
  });

  it("treats a missing listed email as a mismatch", () => {
    const plan = existingOperatorPlan({ $id: "user-1", labels: [] }, "ada@example.com");

    expect(plan.kind).toBe("mismatch");
  });

  it("does not label when the matching user is already an operator", () => {
    const plan = existingOperatorPlan(
      { $id: "user-1", email: "ada@example.com", labels: ["operator"] },
      "ada@example.com",
    );

    expect(plan.kind).toBe("already-operator");
  });
});
