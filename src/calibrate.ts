/**
 * Calibration harness.
 *
 * Each case is a minimal pair: two utterances that differ in exactly one
 * behavior, plus the ordering the instrument has to produce. Absolute score
 * values depend on thresholds that are still provisional; the ordering is what
 * the construct actually claims, so that is what gets asserted.
 *
 * This is the file to run after any lexicon edit. A rule that fixes one case
 * and quietly breaks three others is the normal failure mode for hand-built
 * lexicons, and only a standing suite catches it.
 *
 * Run: node dist/calibrate.js
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scoreLinguistic } from "./linguistic.js";
import { parseTranscript } from "./parse.js";
import type { IndicatorKey } from "./rubrics.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "..", "fixtures");

interface Case {
  id: string;
  indicator: IndicatorKey;
  claim: string;
  /** Preceding turn, when the case depends on conversational context. */
  context?: string;
  higher: string;
  lower: string;
  /** Equal densities pass. Use where the claim is "no better than". */
  allowTie?: boolean;
  /** Require both sides to score, so the case tests grading and not just firing. */
  bothNonZero?: boolean;
}

/** Density for the speaker in a one- or two-turn snippet. */
function density(utterance: string, indicator: IndicatorKey, context?: string): number {
  const text = context ? `${context}\n${utterance}` : utterance;
  const conv = parseTranscript(text);
  const { speakers } = scoreLinguistic(conv, [indicator]);
  const ana = speakers.find((s) => s.speaker === "Ana");
  return ana ? ana.densities[indicator] : 0;
}

export interface CalibrationResult {
  passed: number;
  failed: number;
  /** Adversarial cases the lexicon is known to get wrong, tracked over time. */
  limitationsHandled: number;
  limitationsMissed: string[];
}

export function runCalibration(verbose = true): CalibrationResult {
  const raw = JSON.parse(
    readFileSync(path.join(fixtures, "calibration.json"), "utf8"),
  ) as { cases: Case[]; knownLimitations: Case[] };

  let passed = 0;
  let failed = 0;

  for (const c of raw.cases) {
    const hi = density(c.higher, c.indicator, c.context);
    const lo = density(c.lower, c.indicator, c.context);

    let ok = c.allowTie ? hi >= lo : hi > lo;
    let extra = "";
    if (ok && c.bothNonZero && lo === 0) {
      // Ordering that only holds because the weaker side scored nothing proves
      // the marker fired, not that the two are graded apart.
      ok = false;
      extra = " — lower side scored 0, so this does not test grading";
    }

    if (ok) {
      passed++;
      if (verbose) console.log(`  ok   ${c.id}  (${hi.toFixed(2)} vs ${lo.toFixed(2)})`);
    } else {
      failed++;
      console.log(`  FAIL ${c.id}  (${hi.toFixed(2)} vs ${lo.toFixed(2)})${extra}`);
      console.log(`       claim: ${c.claim}`);
      console.log(`       expected higher: ${c.higher.slice(0, 90)}`);
      console.log(`       expected lower:  ${c.lower.slice(0, 90)}`);
    }
  }

  // These are documented weaknesses of pattern matching. They do not fail the
  // run: the point is to keep them measured and visible, and to notice if one
  // ever starts passing.
  const limitationsMissed: string[] = [];
  let limitationsHandled = 0;
  if (verbose) console.log("\n  Known limitations (pattern matching cannot see context):\n");
  for (const c of raw.knownLimitations ?? []) {
    const hi = density(c.higher, c.indicator, c.context);
    const lo = density(c.lower, c.indicator, c.context);
    if (hi > lo) {
      limitationsHandled++;
      if (verbose)
        console.log(`  handled  ${c.id}  (${hi.toFixed(2)} vs ${lo.toFixed(2)})`);
    } else {
      limitationsMissed.push(c.id);
      if (verbose)
        console.log(
          `  MISSED   ${c.id}  (${hi.toFixed(2)} vs ${lo.toFixed(2)}) — ${c.claim}`,
        );
    }
  }

  return { passed, failed, limitationsHandled, limitationsMissed };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(here, "calibrate.js");
if (isMain) {
  console.log("\nCalibration: minimal pairs that must order correctly\n");
  const r = runCalibration();
  console.log(`\n${r.passed} passed, ${r.failed} failed`);
  console.log(
    `${r.limitationsHandled} known limitation(s) handled, ${r.limitationsMissed.length} still open: ${r.limitationsMissed.join(", ") || "none"}`,
  );
  process.exit(r.failed === 0 ? 0 : 1);
}
