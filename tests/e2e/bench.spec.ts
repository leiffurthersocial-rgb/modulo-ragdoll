import { test } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'node:fs';

// Benchmark route: N dummies + a scripted power sequence, avg/p95 frame time per preset.
// Opt-in: BENCH=1 npm run e2e -- --project=desktop bench
const presets = ['ultra', 'high', 'medium', 'low', 'battery'];

for (const preset of presets) {
  test(`bench ${preset}`, async ({ page }, info) => {
    test.skip(!process.env.BENCH, 'set BENCH=1 to run benchmarks');
    test.setTimeout(90_000);
    const dummies = Number(process.env.BENCH_DUMMIES ?? 20);
    await page.goto(`/?bench&preset=${preset}&dummies=${dummies}&seconds=10`);
    await page.waitForFunction(() => !!window.__modulo?.bench, undefined, { timeout: 80_000 });
    const r = await page.evaluate(() => window.__modulo!.bench);
    mkdirSync('test-results', { recursive: true });
    appendFileSync('test-results/bench.jsonl', `${JSON.stringify({ project: info.project.name, preset, dummies, ...(r as object) })}\n`);
    console.log(`[bench] ${info.project.name} ${preset}: ${JSON.stringify(r)}`);
  });
}
