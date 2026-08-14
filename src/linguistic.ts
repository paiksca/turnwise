/**
 * Deterministic scoring engine.
 *
 * The same transcript always produces the same numbers, which is what lets one
 * year be compared against another. A model-judged score changes when the model
 * does.
 *
 * Scores decompose into marker hits with exact character offsets, so the
 * evidence is the text itself.
 *
 * Two signals here are computed rather than matched, because the literature
 * points at them and a word list cannot capture them:
 *
 *   - Follow-up questions: a question whose content words overlap what the
 *     previous speaker just said. Question-asking research finds follow-ups to
 *     be the question type that signals attention, and lexical overlap
 *     with the prior turn is a workable proxy for it.
 *   - Reciprocated disclosure: personal disclosure that answers disclosure from
 *     someone else in the preceding turns.
 */

import { MARKERS_BY_INDICATOR, STOPWORDS, type Marker } from "./lexicon.js";
import { round } from "./metrics.js";
import { INDICATOR_KEYS, RUBRICS, type IndicatorKey } from "./rubrics.js";
import type { Conversation, IndicatorScore, Span, Turn } from "./types.js";

/** One marker hit, anchored to an exact offset. */
export interface MarkerHit {
  markerId: string;
  indicator: IndicatorKey;
  turnIndex: number;
  speaker: string;
  /** The matched text, verbatim. */
  match: string;
  charStart: number;
  charEnd: number;
  weight: number;
  note: string;
  /** The sentence the match sits in, for readable evidence. */
  context: string;
}

export interface SpeakerFeatures {
  speaker: string;
  turnCount: number;
  wordCount: number;
  /** Weighted marker density per 100 words, before threshold mapping. */
  densities: Record<IndicatorKey, number>;
  /** Raw counts of positively-weighted hits, per indicator. */
  counts: Record<IndicatorKey, number>;
  followUpQuestions: number;
  questionTurns: number;
  reciprocatedDisclosures: number;
  hits: MarkerHit[];
}

/**
 * Density (weighted hits per 100 words) that maps to each score boundary.
 *
 * These thresholds are the least-grounded part of the instrument. The feature
 * families come from published work; the cut points are our calibration against
 * a small fixture set and should be treated as provisional. They are exported
 * so they can be re-fit once a hand-coded reference set exists, and so anyone
 * reading a score can see exactly what produced it.
 *
 * Index i is the minimum density required to reach score i+1.
 */
export const THRESHOLDS: Record<IndicatorKey, [number, number, number, number]> = {
  //                    ->1    ->2    ->3    ->4
  receptiveness:       [0.35,  0.90,  1.80,  3.00],
  perspective_taking:  [0.25,  0.70,  1.40,  2.40],
  contempt:            [0.15,  0.50,  1.10,  2.00],
  curiosity:           [0.30,  0.80,  1.60,  2.80],
  concession:          [0.20,  0.55,  1.20,  2.20],
  personal_disclosure: [0.40,  1.00,  2.00,  3.40],
};

/** Rate bonuses for the two computed (non-lexical) signals. */
const FOLLOWUP_BONUS_PER_100W = 1.6;
const RECIPROCITY_BONUS_PER_100W = 1.2;

/** Ceiling on how much counter-markers can subtract, as a share of positives. */
const NEGATIVE_CAP = 0.6;

/**
 * Floor on the denominator when converting marker weight to a rate.
 *
 * A plain per-100-words rate rewards brevity in a way that inverts the
 * construct: "you're right about the notification" is six words with one strong
 * marker and scores 28, while a fifty-word turn that restates the other's
 * position, hedges its own claim, and grants a point scores 11. The short reply
 * is not more receptive. There is just less text to divide by.
 *
 * Dividing by at least MIN_DENOMINATOR words means short utterances are scored
 * on what they contain rather than on their brevity, and sustained work
 * accumulates. Below this length a rate is not estimable anyway, which is why
 * confidence also scales with word count.
 */
const MIN_DENOMINATOR = 75;

export function scoreLinguistic(
  conv: Conversation,
  indicators: IndicatorKey[] = INDICATOR_KEYS,
): { speakers: SpeakerFeatures[]; scores: Map<string, IndicatorScore[]> } {
  const allHits = extractHits(conv, indicators);
  const followUps = detectFollowUpQuestions(conv.turns);
  const reciprocal = detectReciprocatedDisclosure(conv.turns, allHits);

  const speakers: SpeakerFeatures[] = [];
  const scores = new Map<string, IndicatorScore[]>();

  for (const speaker of conv.speakers) {
    const own = conv.turns.filter((t) => t.speaker === speaker);
    const words = own.reduce((n, t) => n + countWords(t.text), 0);
    const hits = allHits.filter((h) => h.speaker === speaker);
    const per100 = 100 / Math.max(words, MIN_DENOMINATOR);

    const densities = {} as Record<IndicatorKey, number>;
    const counts = {} as Record<IndicatorKey, number>;
    for (const key of INDICATOR_KEYS) {
      const forKey = hits.filter((h) => h.indicator === key);
      const positive = forKey.filter((h) => h.weight > 0).reduce((s, h) => s + h.weight, 0);
      const negative = forKey.filter((h) => h.weight < 0).reduce((s, h) => s + Math.abs(h.weight), 0);

      // Counter-markers dampen, they do not annihilate. Someone who does real
      // receptive work and also says one absolute thing has still done the
      // work, and zeroing them out on that basis reads the conversation wrong.
      // The cap keeps the floor at 40% of what the positive evidence earned.
      const damped = positive - Math.min(negative, positive * NEGATIVE_CAP);
      densities[key] = round(Math.max(0, damped) * per100, 3);
      counts[key] = forKey.filter((h) => h.weight > 0).length;
    }

    const speakerFollowUps = followUps.filter((f) => f.speaker === speaker).length;
    const speakerReciprocal = reciprocal.filter((r) => r.speaker === speaker).length;

    // The two computed signals feed their indicators on top of lexical density.
    densities.curiosity = round(
      densities.curiosity + speakerFollowUps * FOLLOWUP_BONUS_PER_100W * per100,
      3,
    );
    densities.personal_disclosure = round(
      densities.personal_disclosure + speakerReciprocal * RECIPROCITY_BONUS_PER_100W * per100,
      3,
    );

    const features: SpeakerFeatures = {
      speaker,
      turnCount: own.length,
      wordCount: words,
      densities,
      counts,
      followUpQuestions: speakerFollowUps,
      questionTurns: own.filter((t) => t.text.includes("?")).length,
      reciprocatedDisclosures: speakerReciprocal,
      hits,
    };
    speakers.push(features);

    scores.set(
      speaker,
      indicators.map((key) => buildIndicatorScore(key, features, conv)),
    );
  }

  return { speakers, scores };
}

function buildIndicatorScore(
  key: IndicatorKey,
  f: SpeakerFeatures,
  conv: Conversation,
): IndicatorScore {
  const rubric = RUBRICS[key];
  const density = f.densities[key];
  const score = densityToScore(key, density);

  const hits = f.hits
    .filter((h) => h.indicator === key)
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));

  const positive = hits.filter((h) => h.weight > 0);
  const negative = hits.filter((h) => h.weight < 0);

  const spans: Span[] = positive.slice(0, 6).map((h) => ({
    turnIndex: h.turnIndex,
    speaker: h.speaker,
    quote: h.context,
    charStart: h.charStart,
    verified: true,
  }));

  return {
    indicator: key,
    label: rubric.label,
    valence: rubric.valence,
    score,
    count: key === "concession" ? positive.length : undefined,
    confidence: computeConfidence(f, key, positive.length),
    rationale: buildRationale(key, f, positive, negative, density, score),
    spans,
  };
}

/**
 * Confidence reflects how much text the score rests on. A speaker with forty
 * words gives a thin signal no matter how many markers fire, and reporting that
 * at the same confidence as a thousand-word contribution would be misleading.
 * Contempt is capped, because tone of voice carries most of it and none of that
 * survives into a transcript.
 */
function computeConfidence(f: SpeakerFeatures, key: IndicatorKey, hitCount: number): number {
  const volume = Math.min(1, f.wordCount / 400);
  const evidence = Math.min(1, hitCount / 3);
  let c = 0.3 + 0.45 * volume + 0.25 * evidence;
  if (key === "contempt") c = Math.min(c, 0.65);
  if (f.wordCount < 60) c = Math.min(c, 0.35);
  return round(Math.max(0.1, Math.min(1, c)), 2);
}

function buildRationale(
  key: IndicatorKey,
  f: SpeakerFeatures,
  positive: MarkerHit[],
  negative: MarkerHit[],
  density: number,
  score: number,
): string {
  const parts: string[] = [];
  const byRule = new Map<string, number>();
  for (const h of positive) byRule.set(h.note, (byRule.get(h.note) ?? 0) + 1);

  if (positive.length === 0) {
    parts.push(`No ${RUBRICS[key].label.toLowerCase()} markers matched in ${f.wordCount} words.`);
  } else {
    const top = [...byRule.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([note, n]) => `${note.toLowerCase()} (${n})`);
    parts.push(
      `${positive.length} marker${positive.length === 1 ? "" : "s"} across ${f.wordCount} words: ${top.join("; ")}.`,
    );
  }

  if (key === "curiosity" && f.followUpQuestions > 0) {
    parts.push(
      `${f.followUpQuestions} of ${f.questionTurns} question turn${f.questionTurns === 1 ? "" : "s"} built on what the previous speaker had just said.`,
    );
  }
  if (key === "personal_disclosure" && f.reciprocatedDisclosures > 0) {
    parts.push(`${f.reciprocatedDisclosures} disclosure(s) followed disclosure from someone else.`);
  }
  if (negative.length > 0) {
    const notes = [...new Set(negative.map((n) => n.note.toLowerCase()))].slice(0, 2);
    parts.push(`Offset by ${negative.length} counter-marker(s): ${notes.join("; ")}.`);
  }

  parts.push(`Weighted density ${density.toFixed(2)} per 100 words maps to ${score} on the scale.`);
  return parts.join(" ");
}

export function densityToScore(key: IndicatorKey, density: number): number {
  const t = THRESHOLDS[key];
  if (density < t[0]) return 0;
  if (density < t[1]) return 1;
  if (density < t[2]) return 2;
  if (density < t[3]) return 3;
  return 4;
}

/* ------------------------------------------------------------------ */
/* Extraction                                                          */
/* ------------------------------------------------------------------ */

export function extractHits(conv: Conversation, indicators: IndicatorKey[]): MarkerHit[] {
  const hits: MarkerHit[] = [];

  for (const turn of conv.turns) {
    for (const key of indicators) {
      for (const marker of MARKERS_BY_INDICATOR[key]) {
        for (const hit of matchAll(marker, turn, key)) hits.push(hit);
      }
    }
  }

  return dedupeOverlapping(hits);
}

function matchAll(marker: Marker, turn: Turn, indicator: IndicatorKey): MarkerHit[] {
  const out: MarkerHit[] = [];
  const quoted = quotedRanges(turn.text);
  // Patterns are module-level and carry lastIndex state; reset before each use.
  const re = new RegExp(marker.pattern.source, marker.pattern.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(turn.text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    // Words the speaker is quoting belong to whoever said them. "He stood up
    // and said 'you're right, I was wrong'" reports what someone else said.
    if (quoted.some(([a, b]) => m!.index >= a && m!.index < b)) continue;
    out.push({
      markerId: marker.id,
      indicator,
      turnIndex: turn.index,
      speaker: turn.speaker,
      match: m[0],
      charStart: m.index,
      charEnd: m.index + m[0].length,
      weight: marker.weight,
      note: marker.note,
      context: sentenceAround(turn.text, m.index, m.index + m[0].length),
    });
  }
  return out;
}

/**
 * When a negative marker overlaps a positive one, the negative wins and the
 * positive is dropped. This is what makes "you're right, but" score below a
 * plain disagreement rather than above it: the hollow-concession pattern
 * suppresses the grant it contains.
 */
function dedupeOverlapping(hits: MarkerHit[]): MarkerHit[] {
  const negatives = hits.filter((h) => h.weight < 0);
  return hits.filter((h) => {
    if (h.weight < 0) return true;
    return !negatives.some(
      (n) =>
        n.turnIndex === h.turnIndex &&
        n.indicator === h.indicator &&
        h.charStart >= n.charStart &&
        h.charStart < n.charEnd,
    );
  });
}

/**
 * Character ranges inside quotation marks.
 *
 * Handles straight and curly quotes. Unpaired quotes are ignored, so an
 * apostrophe or a lone quote mark cannot swallow the rest of the turn.
 */
export function quotedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["“", "”"],
    ["‘", "’"],
  ];

  for (const [open, close] of pairs) {
    let searchFrom = 0;
    while (searchFrom < text.length) {
      const start = text.indexOf(open, searchFrom);
      if (start === -1) break;
      // For straight quotes the same character closes the span.
      const end = text.indexOf(close, start + 1);
      if (end === -1) break;
      // A very long span is more likely mismatched punctuation than a quotation.
      if (end - start <= 300) ranges.push([start, end + 1]);
      searchFrom = end + 1;
    }
  }
  return ranges;
}

/** The sentence containing a match, trimmed so evidence reads naturally. */
function sentenceAround(text: string, start: number, end: number): string {
  let a = start;
  while (a > 0 && !/[.!?]/.test(text[a - 1])) a--;
  let b = end;
  while (b < text.length && !/[.!?]/.test(text[b])) b++;
  if (b < text.length) b++;
  const slice = text.slice(a, b).trim();
  return slice.length > 220 ? `${slice.slice(0, 217).trim()}...` : slice;
}

/* ------------------------------------------------------------------ */
/* Computed signals                                                    */
/* ------------------------------------------------------------------ */

export interface FollowUp {
  turnIndex: number;
  speaker: string;
  /** Content words shared with the previous speaker's turn. */
  sharedTerms: string[];
}

/**
 * A question turn counts as a follow-up when it asks something AND reuses
 * content words from the immediately preceding turn by a different speaker.
 * Reusing the other person's words is the observable trace of having listened
 * to them, which is what separates a follow-up from a topic switch.
 */
export function detectFollowUpQuestions(turns: Turn[]): FollowUp[] {
  const out: FollowUp[] = [];
  for (let i = 1; i < turns.length; i++) {
    const cur = turns[i];
    const prev = turns[i - 1];
    if (!cur.text.includes("?")) continue;
    if (prev.speaker === cur.speaker) continue;

    const prevTerms = contentWords(prev.text);
    const curTerms = contentWords(cur.text);
    const shared = [...curTerms].filter((w) => prevTerms.has(w));
    if (shared.length >= 2) {
      out.push({ turnIndex: cur.index, speaker: cur.speaker, sharedTerms: shared.slice(0, 5) });
    }
  }
  return out;
}

export interface Reciprocity {
  turnIndex: number;
  speaker: string;
  respondingTo: number;
}

/** Disclosure that lands within two turns of someone else's disclosure. */
export function detectReciprocatedDisclosure(turns: Turn[], hits: MarkerHit[]): Reciprocity[] {
  const disclosureTurns = hits
    .filter((h) => h.indicator === "personal_disclosure" && h.weight > 0)
    .map((h) => ({ turnIndex: h.turnIndex, speaker: h.speaker }));

  const byTurn = new Map<number, string>();
  for (const d of disclosureTurns) byTurn.set(d.turnIndex, d.speaker);

  const out: Reciprocity[] = [];
  for (const [turnIndex, speaker] of [...byTurn.entries()].sort((a, b) => a[0] - b[0])) {
    for (let back = 1; back <= 2; back++) {
      const priorSpeaker = byTurn.get(turnIndex - back);
      if (priorSpeaker && priorSpeaker !== speaker) {
        out.push({ turnIndex, speaker, respondingTo: turnIndex - back });
        break;
      }
    }
  }
  return out;
}

function contentWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z']{3,}/g) ?? [];
  return new Set(words.filter((w) => !STOPWORDS.has(w)).map(stem));
}

/** Crude suffix stripping so "building" and "buildings" match. */
function stem(w: string): string {
  return w
    .replace(/(?:ing|ed|ly|es|s)$/u, "")
    .replace(/(.)\1$/u, "$1");
}

function countWords(s: string): number {
  return s.trim().match(/\S+/g)?.length ?? 0;
}
