import type { IndicatorKey, Valence } from "./rubrics.js";

/** One speaker turn, after normalization. */
export interface Turn {
  /** 0-based position in the conversation. Spans reference this. */
  index: number;
  speaker: string;
  text: string;
  /** Seconds from conversation start, when the source format carries timing. */
  startSec?: number;
  endSec?: number;
}

export interface Conversation {
  id: string;
  turns: Turn[];
  speakers: string[];
  sourceFormat: SourceFormat;
  /** Free-form: workshop name, date, cohort, site. Carried into reports. */
  meta?: Record<string, string>;
}

export type SourceFormat = "vtt" | "srt" | "otter" | "speaker_colon" | "json" | "unknown";

/**
 * A quoted piece of evidence anchored to a turn.
 *
 * Spans come from exact pattern matches, so `verified` is true by construction
 * and `charStart` always indexes into the turn text. The field is kept explicit
 * so consumers can assert on it.
 */
export interface Span {
  turnIndex: number;
  speaker: string;
  /** The sentence containing the match, verbatim from the turn. */
  quote: string;
  /** Character offset of the match within the turn text. */
  charStart: number;
  verified: boolean;
}

export interface IndicatorScore {
  indicator: IndicatorKey;
  label: string;
  valence: Valence;
  /** 0-4. Null when the indicator could not be scored; reason in rationale. */
  score: number | null;
  /** For countable indicators (concession), the number of distinct instances. */
  count?: number;
  /** 0-1. Derived from how much text the score rests on and how many markers fired. */
  confidence: number;
  rationale: string;
  spans: Span[];
}

export interface SpeakerScores {
  speaker: string;
  turnCount: number;
  wordCount: number;
  indicators: IndicatorScore[];
}

/** Deterministic, model-free metrics. Computed directly from the text. */
export interface StructureMetrics {
  turnCount: number;
  wordCount: number;
  speakerCount: number;
  perSpeaker: Array<{
    speaker: string;
    turns: number;
    words: number;
    /** Share of total words, 0-1. */
    airtimeShare: number;
    /** Turns containing at least one question mark. */
    questionTurns: number;
    meanWordsPerTurn: number;
  }>;
  /**
   * Gini coefficient of word counts across speakers, 0-1.
   * 0 = perfectly even airtime, 1 = one speaker holds the floor entirely.
   */
  airtimeGini: number;
  /** Fraction of turns that contain a question mark. */
  questionRate: number;
  durationSec?: number;
}

export interface ConversationScore {
  conversationId: string;
  /** Scoring engine identifier, recorded so reports are reproducible. */
  model: string;
  scoredAt: string;
  rubricVersion: string;
  structure: StructureMetrics;
  speakers: SpeakerScores[];
  /** Mean across speakers, per indicator. */
  conversationMeans: Array<{
    indicator: IndicatorKey;
    label: string;
    valence: Valence;
    mean: number | null;
    confidence: number;
  }>;
  /** Populated when arc analysis was requested. */
  arc?: ArcAnalysis;
  warnings: string[];
  meta?: Record<string, string>;
}

export interface ArcSegment {
  label: string;
  /** Inclusive turn range. */
  fromTurn: number;
  toTurn: number;
  indicators: IndicatorScore[];
}

export interface ArcAnalysis {
  segments: ArcSegment[];
  /** Last segment minus first, per indicator. */
  deltas: Array<{
    indicator: IndicatorKey;
    label: string;
    valence: Valence;
    first: number | null;
    last: number | null;
    delta: number | null;
    /** Whether the direction of change is the desirable one. */
    favorable: boolean | null;
  }>;
}

export interface CohortReport {
  conversationCount: number;
  speakerObservations: number;
  generatedAt: string;
  rubricVersion: string;
  indicators: Array<{
    indicator: IndicatorKey;
    label: string;
    valence: Valence;
    n: number;
    mean: number | null;
    sd: number | null;
    median: number | null;
    meanConfidence: number;
  }>;
  /** Present when conversations carry a comparable grouping key. */
  groups?: Array<{
    group: string;
    n: number;
    indicators: Array<{
      indicator: IndicatorKey;
      mean: number | null;
      sd: number | null;
    }>;
  }>;
  /** Present when exactly two groups are compared. */
  comparison?: Array<{
    indicator: IndicatorKey;
    label: string;
    groupA: string;
    groupB: string;
    meanA: number | null;
    meanB: number | null;
    difference: number | null;
    /** Cohen's d, pooled SD. */
    cohensD: number | null;
  }>;
  caveats: string[];
}
