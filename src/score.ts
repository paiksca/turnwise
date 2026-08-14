/**
 * Scoring orchestration.
 *
 * Everything here is deterministic and local. The server does not call a model;
 * it is called BY one. That split is deliberate:
 *
 *   - This layer does what code does well: exact marker matching, counting,
 *     rate normalization, arithmetic.
 *   - The calling model does what models do well: reading the evidence, judging
 *     whether a concession was genuine, catching sarcasm a word list misses,
 *     and writing the narrative for a human.
 *
 * Scores therefore stay stable across model versions.
 */

import { computeStructure, mean, round, segmentTurns } from "./metrics.js";
import { scoreLinguistic, type MarkerHit, type SpeakerFeatures } from "./linguistic.js";
import { INDICATOR_KEYS, RUBRICS, type IndicatorKey } from "./rubrics.js";
import type {
  ArcAnalysis,
  ArcSegment,
  Conversation,
  ConversationScore,
  IndicatorScore,
  SpeakerScores,
} from "./types.js";

export const RUBRIC_VERSION = "1.0.0";
export const ENGINE = "linguistic-deterministic";

export interface ScoreOptions {
  indicators?: IndicatorKey[];
  /** Split into this many slices and score each, to show change over a session. */
  arcSegments?: number;
}

export function scoreConversation(
  conv: Conversation,
  opts: ScoreOptions = {},
): ConversationScore & { features: SpeakerFeatures[] } {
  const indicators = opts.indicators?.length ? opts.indicators : INDICATOR_KEYS;
  const warnings = collectWarnings(conv);

  const { speakers: features, scores } = scoreLinguistic(conv, indicators);

  const speakers: SpeakerScores[] = features.map((f) => ({
    speaker: f.speaker,
    turnCount: f.turnCount,
    wordCount: f.wordCount,
    indicators: scores.get(f.speaker) ?? [],
  }));

  for (const f of features) {
    if (f.wordCount < 60) {
      warnings.push(
        `${f.speaker} contributed only ${f.wordCount} words. Rate-based scores over that little text are unstable. Treat them as directional.`,
      );
    }
  }

  const conversationMeans = indicators.map((key) => {
    const vals = speakers
      .map((s) => s.indicators.find((i) => i.indicator === key)?.score)
      .filter((v): v is number => v !== null && v !== undefined);
    const confs = speakers.map(
      (s) => s.indicators.find((i) => i.indicator === key)?.confidence ?? 0,
    );
    return {
      indicator: key,
      label: RUBRICS[key].label,
      valence: RUBRICS[key].valence,
      mean: mean(vals),
      confidence: round(mean(confs) ?? 0, 2),
    };
  });

  const arc =
    opts.arcSegments && opts.arcSegments > 1
      ? scoreArc(conv, indicators, opts.arcSegments, warnings)
      : undefined;

  return {
    conversationId: conv.id,
    model: ENGINE,
    scoredAt: new Date().toISOString(),
    rubricVersion: RUBRIC_VERSION,
    structure: computeStructure(conv),
    speakers,
    conversationMeans,
    arc,
    warnings,
    meta: conv.meta,
    features,
  };
}

function collectWarnings(conv: Conversation): string[] {
  const warnings: string[] = [];
  if (conv.turns.length === 0) {
    throw new Error("Transcript contains no turns after parsing. Check the source format.");
  }
  if (conv.speakers.length === 1) {
    warnings.push(
      "Only one speaker was detected. Indicators about engaging across difference are not meaningful here. If this came from single-track audio, speaker labels were never present; see transcribe_session for per-speaker recording.",
    );
  }
  if (conv.speakers.includes("Unknown")) {
    warnings.push(
      "Some turns had no speaker label and were grouped under 'Unknown', so those scores mix people together.",
    );
  }
  if (conv.turns.length < 6) {
    warnings.push(
      `Only ${conv.turns.length} turns. Scores on a conversation this short are indicative at best.`,
    );
  }
  return warnings;
}

/** Score contiguous slices so change across the session is visible. */
function scoreArc(
  conv: Conversation,
  indicators: IndicatorKey[],
  segmentCount: number,
  warnings: string[],
): ArcAnalysis {
  const ranges = segmentTurns(conv.turns.length, segmentCount);
  if (conv.turns.length < segmentCount * 4) {
    warnings.push(
      `Arc analysis split ${conv.turns.length} turns into ${ranges.length} segments, leaving few turns each. Read the arc as directional only.`,
    );
  }

  const segments: ArcSegment[] = ranges.map((r, i) => {
    const slice = conv.turns.slice(r.from, r.to + 1).map((t, j) => ({ ...t, index: j }));
    const sub: Conversation = {
      ...conv,
      turns: slice,
      speakers: [...new Set(slice.map((t) => t.speaker))],
    };
    const { scores } = scoreLinguistic(sub, indicators);

    const segIndicators: IndicatorScore[] = indicators.map((key) => {
      const rows = [...scores.values()]
        .flat()
        .filter((s) => s.indicator === key);
      const vals = rows.map((r2) => r2.score).filter((v): v is number => v !== null);
      return {
        indicator: key,
        label: RUBRICS[key].label,
        valence: RUBRICS[key].valence,
        score: mean(vals),
        confidence: round(mean(rows.map((r2) => r2.confidence)) ?? 0, 2),
        rationale: rows.map((r2) => `${r2.spans.length} span(s)`).join(", "),
        // Re-anchor spans onto original turn indices.
        spans: rows.flatMap((r2) =>
          r2.spans.map((s) => ({ ...s, turnIndex: s.turnIndex + r.from })),
        ),
      };
    });

    return {
      label: labelSegment(i, ranges.length),
      fromTurn: r.from,
      toTurn: r.to,
      indicators: segIndicators,
    };
  });

  const first = segments[0];
  const last = segments[segments.length - 1];
  const deltas = indicators.map((key) => {
    const a = first.indicators.find((i) => i.indicator === key)?.score ?? null;
    const b = last.indicators.find((i) => i.indicator === key)?.score ?? null;
    const delta = a !== null && b !== null ? round(b - a, 2) : null;
    const valence = RUBRICS[key].valence;
    const favorable =
      delta === null || delta === 0 ? null : valence === "positive" ? delta > 0 : delta < 0;
    return {
      indicator: key,
      label: RUBRICS[key].label,
      valence,
      first: a,
      last: b,
      delta,
      favorable,
    };
  });

  return { segments, deltas };
}

function labelSegment(i: number, total: number): string {
  if (total === 3) return ["Opening third", "Middle third", "Closing third"][i];
  if (total === 2) return ["First half", "Second half"][i];
  return `Segment ${i + 1} of ${total}`;
}

/* ------------------------------------------------------------------ */
/* Evidence package for the calling model                              */
/* ------------------------------------------------------------------ */

export interface EvidencePackage {
  conversationId: string;
  rubricVersion: string;
  /** What the deterministic layer found, for the caller to reason over. */
  candidates: Array<{
    indicator: IndicatorKey;
    label: string;
    valence: string;
    speaker: string;
    turnIndex: number;
    matched: string;
    quote: string;
    rule: string;
    direction: "supports" | "counts_against";
  }>;
  /** Turns with no marker hits, where a word list is most likely to miss something. */
  unmatchedTurns: Array<{ turnIndex: number; speaker: string; text: string }>;
  reviewGuidance: string[];
}

/**
 * Package the deterministic findings for the calling model to adjudicate.
 *
 * Marker matching has two failure modes a model can fix and code cannot:
 * false positives, where a phrase matched but does not mean what the rule
 * assumes (sarcastic "good point"), and false negatives, where a speaker did
 * something the lexicon has no pattern for. Turns with no hits are included for
 * exactly that reason.
 */
export function buildEvidencePackage(
  conv: Conversation,
  hits: MarkerHit[],
  indicators: IndicatorKey[] = INDICATOR_KEYS,
): EvidencePackage {
  const relevant = hits.filter((h) => indicators.includes(h.indicator));
  const hitTurns = new Set(relevant.map((h) => h.turnIndex));

  return {
    conversationId: conv.id,
    rubricVersion: RUBRIC_VERSION,
    candidates: relevant.map((h) => ({
      indicator: h.indicator,
      label: RUBRICS[h.indicator].label,
      valence: RUBRICS[h.indicator].valence,
      speaker: h.speaker,
      turnIndex: h.turnIndex,
      matched: h.match,
      quote: h.context,
      rule: h.note,
      direction: h.weight > 0 ? "supports" : "counts_against",
    })),
    unmatchedTurns: conv.turns
      .filter((t) => !hitTurns.has(t.index))
      .map((t) => ({ turnIndex: t.index, speaker: t.speaker, text: t.text })),
    reviewGuidance: [
      "Each candidate is an exact pattern match, not a judgment. Confirm or reject each one against the quote.",
      "Reject a candidate when the phrase does not carry its usual meaning here. Sarcastic agreement, quoted speech, and someone repeating another person's words back to criticize them all match patterns they should not.",
      "The unmatched turns are where a word list is weakest. Read them for behavior no pattern would catch: an unusual concession, contempt carried entirely by implication, a story told without any of the usual framing.",
      "Contempt is systematically undercounted in text, because tone of voice carries most of it. Weight ambiguous cases toward the reading the transcript supports rather than assuming the worst.",
      "When you report back, keep every number attached to the quote it rests on, and say plainly where the evidence is thin.",
    ],
  };
}
