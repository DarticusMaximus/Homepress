import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createNewsletterConfig,
  runPipeline,
  type NewsletterConfig,
  type NewsletterConfigInput,
} from "@newsletter/shared";

async function main(): Promise<void> {
  const configPath = process.argv[2];
  if (!configPath) {
    console.error("Usage: tsx --env-file=.env src/parity-run.ts <config-path>");
    process.exit(2);
  }

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (e) {
    console.error(
      `Failed to read config file: ${configPath}: ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exit(2);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error(`Invalid JSON in ${configPath}: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }

  let config: NewsletterConfig;
  try {
    config = createNewsletterConfig(parsed as NewsletterConfigInput);
  } catch (e) {
    console.error(`Invalid newsletter config: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }

  const result = await runPipeline(config);

  const lines: string[] = [];
  lines.push(`status: ${result.status}`);
  if (result.status === "failed") {
    lines.push(`failedPhase: ${result.failedPhase}`);
    lines.push(`failureReason: ${result.failureReason}`);
  }
  lines.push(
    `totals: fetched=${result.totals.fetched} scraped=${result.totals.scraped} tagged=${result.totals.tagged} scored=${result.totals.scored} selected=${result.totals.selected}`,
  );
  lines.push(
    `fetch: feeds-failed=${result.phases.fetch.failedFeeds.length} total-feeds=${result.phases.fetch.totalFeeds}`,
  );
  lines.push(
    `scrape: extracted=${result.phases.scrape.extracted} fallback=${result.phases.scrape.fallback} total=${result.phases.scrape.total}`,
  );
  lines.push(
    `tag: failures=${result.phases.tag.failures.length} halted=${result.phases.tag.halted}`,
  );
  lines.push(
    `score: failures=${result.phases.score.failures.length} halted=${result.phases.score.halted}`,
  );
  lines.push(
    `selection: candidate=${result.phases.selection.candidateCount} target=${result.phases.selection.targetCount} failures=${result.phases.selection.failures.length}`,
  );
  lines.push(
    `draft: attempts=${result.phases.draft.attempts} empty=${result.phases.draft.empty} reason=${result.phases.draft.reason ?? "-"}`,
  );
  console.error(lines.join("\n"));

  if (result.status === "ok") {
    const today = new Date().toISOString().slice(0, 10);
    const outDir = join(process.cwd(), "output");
    mkdirSync(outDir, { recursive: true });
    const outFile = join(outDir, `${config.name}-${today}.md`);
    writeFileSync(outFile, result.markdown, "utf8");
    console.log(outFile);
    process.exit(0);
  } else {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`Unhandled error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
