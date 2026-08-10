import { describe, it, expect } from "vitest";
import nextConfig from "../../next.config.mjs";

describe("next.config.mjs RSS rewrite (case 17b)", () => {
  it("rewrites /rss/:newsletterId.xml to /rss/:newsletterId", async () => {
    expect(typeof nextConfig.rewrites).toBe("function");

    const rewrites = await nextConfig.rewrites!();
    expect(rewrites).toEqual(
      expect.arrayContaining([
        {
          source: "/rss/:newsletterId.xml",
          destination: "/rss/:newsletterId",
        },
      ]),
    );
  });
});
