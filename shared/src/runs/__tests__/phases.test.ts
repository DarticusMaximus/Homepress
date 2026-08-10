import { describe, it, expect } from "vitest";
import { PHASE_ORDER, nextPhase, resumeStartPhase } from "../phases";
import { RUN_PHASES } from "../../schema/declarations";

describe("PHASE_ORDER", () => {
  it("matches the expected phase order", () => {
    expect(PHASE_ORDER).toEqual(["fetch", "scrape", "tag", "score", "selection", "draft"]);
  });

  it("matches RUN_PHASES from declarations", () => {
    expect(PHASE_ORDER).toEqual(RUN_PHASES);
  });
});

describe("nextPhase", () => {
  it("returns the next phase for each phase in order", () => {
    expect(nextPhase("fetch")).toBe("scrape");
    expect(nextPhase("scrape")).toBe("tag");
    expect(nextPhase("tag")).toBe("score");
    expect(nextPhase("score")).toBe("selection");
    expect(nextPhase("selection")).toBe("draft");
  });

  it("returns null for the last phase", () => {
    expect(nextPhase("draft")).toBeNull();
  });
});

describe("resumeStartPhase", () => {
  it("returns 'fetch' for null or empty completed phase", () => {
    expect(resumeStartPhase(null)).toBe("fetch");
    expect(resumeStartPhase("")).toBe("fetch");
  });

  it("returns the next phase after a completed phase", () => {
    expect(resumeStartPhase("fetch")).toBe("scrape");
    expect(resumeStartPhase("scrape")).toBe("tag");
    expect(resumeStartPhase("tag")).toBe("score");
    expect(resumeStartPhase("score")).toBe("selection");
    expect(resumeStartPhase("selection")).toBe("draft");
  });

  it("returns null when completed phase is the last phase", () => {
    expect(resumeStartPhase("draft")).toBeNull();
  });
});
