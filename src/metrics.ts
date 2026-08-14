/**
 * Deterministic conversation metrics.
 *
 * No model involved. These are cheap, reproducible, and defensible without any
 * claim about judgment — which makes them the right things to put next to the
 * model-judged indicators in a funder report. Airtime imbalance in particular
 * is a facilitation signal that needs no interpretation.
 */

import { wordCount } from "./parse.js";
import type { Conversation, StructureMetrics } from "./types.js";

export function computeStructure(conv: Conversation): StructureMetrics {
  const { turns, speakers } = conv;

  const perSpeaker = speakers.map((speaker) => {
    const own = turns.filter((t) => t.speaker === speaker);
    const words = own.reduce((sum, t) => sum + wordCount(t.text), 0);
    return {
      speaker,
      turns: own.length,
      words,
      airtimeShare: 0, // filled below once the total is known
      questionTurns: own.filter((t) => t.text.includes("?")).length,
      meanWordsPerTurn: own.length ? round(words / own.length, 1) : 0,
    };
  });

  const totalWords = perSpeaker.reduce((s, p) => s + p.words, 0);
  for (const p of perSpeaker) {
    p.airtimeShare = totalWords ? round(p.words / totalWords, 4) : 0;
  }

  const questionTurns = turns.filter((t) => t.text.includes("?")).length;

  const starts = turns.map((t) => t.startSec).filter((v): v is number => v !== undefined);
  const ends = turns.map((t) => t.endSec).filter((v): v is number => v !== undefined);
  const durationSec =
    starts.length && ends.length ? round(Math.max(...ends) - Math.min(...starts), 1) : undefined;

  return {
    turnCount: turns.length,
    wordCount: totalWords,
    speakerCount: speakers.length,
    perSpeaker,
    airtimeGini: round(gini(perSpeaker.map((p) => p.words)), 4),
    questionRate: turns.length ? round(questionTurns / turns.length, 4) : 0,
    durationSec,
  };
}

/**
 * Gini coefficient over word counts. 0 = every speaker holds the floor equally,
 * 1 = one speaker holds all of it. Reported for 2+ speakers only; a single
 * speaker has no distribution to describe.
 */
export function gini(values: number[]): number {
  const v = values.filter((x) => x >= 0).sort((a, b) => a - b);
  const n = v.length;
  if (n < 2) return 0;
  const total = v.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * v[i];
  return (2 * weighted) / (n * total) - (n + 1) / n;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return round(values.reduce((a, b) => a + b, 0) / values.length, 3);
}

/** Sample standard deviation (n-1). Null below two observations. */
export function sd(values: number[]): number | null {
  const n = values.length;
  if (n < 2) return null;
  const m = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((acc, x) => acc + (x - m) ** 2, 0) / (n - 1);
  return round(Math.sqrt(variance), 3);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return round(v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2, 3);
}

/** Cohen's d with pooled SD. Null when either group has fewer than two values. */
export function cohensD(a: number[], b: number[]): number | null {
  if (a.length < 2 || b.length < 2) return null;
  const ma = a.reduce((x, y) => x + y, 0) / a.length;
  const mb = b.reduce((x, y) => x + y, 0) / b.length;
  const va = a.reduce((acc, x) => acc + (x - ma) ** 2, 0) / (a.length - 1);
  const vb = b.reduce((acc, x) => acc + (x - mb) ** 2, 0) / (b.length - 1);
  const pooled = Math.sqrt(
    ((a.length - 1) * va + (b.length - 1) * vb) / (a.length + b.length - 2),
  );
  if (pooled === 0) return null;
  return round((ma - mb) / pooled, 3);
}

export function round(n: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Split turns into n contiguous segments of roughly equal turn count. */
export function segmentTurns(
  turnCount: number,
  segments: number,
): Array<{ from: number; to: number }> {
  const n = Math.max(1, Math.min(segments, turnCount));
  const size = turnCount / n;
  const out: Array<{ from: number; to: number }> = [];
  for (let i = 0; i < n; i++) {
    const from = Math.round(i * size);
    const to = (i === n - 1 ? turnCount : Math.round((i + 1) * size)) - 1;
    if (to >= from) out.push({ from, to });
  }
  return out;
}
