/**
 * Transcript normalization.
 *
 * Bridging organizations record on Zoom, Otter, Rev, Descript, or a volunteer
 * with a notepad. All of it has to land as the same `Turn[]`. Parsing is
 * deterministic and model-free, so `parse_transcript` runs offline.
 *
 * Consecutive segments from the same speaker are merged into one turn, because
 * caption formats split a single utterance across many cue blocks and a turn
 * count computed on raw cues is meaningless.
 */

import type { Conversation, SourceFormat, Turn } from "./types.js";

const TIMECODE_ARROW = /-->/;
const VTT_HEADER = /^WEBVTT/;

/** `<v Speaker>text</v>` or `Speaker: text` inside a cue payload. */
const VOICE_TAG = /^<v\s+([^>]+)>([\s\S]*?)(?:<\/v>)?$/i;
const SPEAKER_PREFIX = /^([A-Za-z0-9][^:\n]{0,60}?)\s*:\s*([\s\S]*)$/;
/** Otter/Rev often write `Name  00:03` or `Name (00:03):` on its own line. */
const OTTER_SPEAKER_LINE =
  /^([A-Za-z][A-Za-z0-9 .,'’\-]{0,50}?)\s*(?:\(?\s*\d{1,2}:\d{2}(?::\d{2})?\s*\)?)\s*:?\s*$/;

export interface ParseOptions {
  /** Override auto-detection. */
  format?: SourceFormat;
  /** Conversation id for the report. Defaults to a content hash. */
  id?: string;
  meta?: Record<string, string>;
  /**
   * Map raw transcript names onto stable labels, e.g. {"Speaker 1": "Participant A"}.
   * Applied after parsing.
   */
  speakerAliases?: Record<string, string>;
}

export function detectFormat(raw: string): SourceFormat {
  const text = raw.trimStart();
  if (VTT_HEADER.test(text)) return "vtt";

  const trimmed = text.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      /* not JSON, keep sniffing */
    }
  }

  const lines = text.split(/\r?\n/);
  // SRT: a bare integer line followed by a timecode line.
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^\d+$/.test(lines[i].trim()) && TIMECODE_ARROW.test(lines[i + 1])) {
      return "srt";
    }
  }
  if (lines.some((l) => TIMECODE_ARROW.test(l))) return "vtt";
  if (lines.some((l) => OTTER_SPEAKER_LINE.test(l.trim()))) return "otter";
  if (lines.some((l) => SPEAKER_PREFIX.test(l.trim()))) return "speaker_colon";
  return "unknown";
}

export function parseTranscript(raw: string, opts: ParseOptions = {}): Conversation {
  const format = opts.format ?? detectFormat(raw);

  let turns: Turn[];
  switch (format) {
    case "vtt":
      turns = parseCueFormat(raw, "vtt");
      break;
    case "srt":
      turns = parseCueFormat(raw, "srt");
      break;
    case "otter":
      turns = parseOtter(raw);
      break;
    case "json":
      turns = parseJson(raw);
      break;
    case "speaker_colon":
      turns = parseSpeakerColon(raw);
      break;
    default:
      turns = parseSpeakerColon(raw);
      if (turns.length === 0) turns = parseUnlabeled(raw);
  }

  turns = mergeConsecutive(turns);
  if (opts.speakerAliases) turns = applyAliases(turns, opts.speakerAliases);
  turns = turns.map((t, i) => ({ ...t, index: i }));

  const speakers = [...new Set(turns.map((t) => t.speaker))];

  return {
    id: opts.id ?? contentId(raw),
    turns,
    speakers,
    sourceFormat: format,
    meta: opts.meta,
  };
}

/* ------------------------------------------------------------------ */
/* Format-specific parsers                                             */
/* ------------------------------------------------------------------ */

/** WebVTT and SRT share a cue structure; only the header and index lines differ. */
function parseCueFormat(raw: string, kind: "vtt" | "srt"): Turn[] {
  const blocks = raw
    .replace(/^﻿/, "")
    .split(/\r?\n\s*\r?\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const turns: Turn[] = [];

  for (const block of blocks) {
    if (kind === "vtt" && VTT_HEADER.test(block) && !TIMECODE_ARROW.test(block)) continue;
    if (/^(NOTE|STYLE|REGION)\b/.test(block)) continue;

    const lines = block.split(/\r?\n/);
    let timecodeIdx = lines.findIndex((l) => TIMECODE_ARROW.test(l));
    if (timecodeIdx === -1) continue;

    const [startSec, endSec] = parseTimecodeLine(lines[timecodeIdx]);
    const payload = lines.slice(timecodeIdx + 1).join("\n").trim();
    if (!payload) continue;

    const { speaker, text } = extractSpeaker(payload);
    if (!text) continue;

    turns.push({ index: 0, speaker, text, startSec, endSec });
  }

  return turns;
}

function parseTimecodeLine(line: string): [number | undefined, number | undefined] {
  const parts = line.split(TIMECODE_ARROW);
  if (parts.length < 2) return [undefined, undefined];
  return [parseTimestamp(parts[0]), parseTimestamp(parts[1])];
}

/** Accepts `HH:MM:SS.mmm`, `MM:SS.mmm`, and the SRT comma variant. */
function parseTimestamp(s: string): number | undefined {
  const m = s.trim().match(/(\d{1,3}):(\d{2})(?::(\d{2}))?[.,](\d{1,3})/);
  if (m) {
    const [, a, b, c, ms] = m;
    const hasHours = c !== undefined;
    const h = hasHours ? Number(a) : 0;
    const min = hasHours ? Number(b) : Number(a);
    const sec = hasHours ? Number(c) : Number(b);
    return h * 3600 + min * 60 + sec + Number(ms.padEnd(3, "0")) / 1000;
  }
  const plain = s.trim().match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
  if (plain) {
    const [, a, b, c] = plain;
    return c !== undefined
      ? Number(a) * 3600 + Number(b) * 60 + Number(c)
      : Number(a) * 60 + Number(b);
  }
  return undefined;
}

function extractSpeaker(payload: string): { speaker: string; text: string } {
  const voice = payload.match(VOICE_TAG);
  if (voice) {
    return { speaker: cleanSpeaker(voice[1]), text: stripTags(voice[2]).trim() };
  }
  const prefixed = payload.match(SPEAKER_PREFIX);
  if (prefixed && looksLikeSpeakerName(prefixed[1])) {
    return { speaker: cleanSpeaker(prefixed[1]), text: stripTags(prefixed[2]).trim() };
  }
  return { speaker: "Unknown", text: stripTags(payload).trim() };
}

/** Otter/Rev: a speaker line, then the utterance on following lines. */
function parseOtter(raw: string): Turn[] {
  const lines = raw.split(/\r?\n/);
  const turns: Turn[] = [];
  let speaker = "Unknown";
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join(" ").replace(/\s+/g, " ").trim();
    if (text) turns.push({ index: 0, speaker, text });
    buffer = [];
  };

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const header = t.match(OTTER_SPEAKER_LINE);
    if (header && looksLikeSpeakerName(header[1])) {
      flush();
      speaker = cleanSpeaker(header[1]);
      continue;
    }
    const inline = t.match(SPEAKER_PREFIX);
    if (inline && looksLikeSpeakerName(inline[1])) {
      flush();
      speaker = cleanSpeaker(inline[1]);
      buffer.push(inline[2].trim());
      continue;
    }
    buffer.push(t);
  }
  flush();
  return turns;
}

function parseSpeakerColon(raw: string): Turn[] {
  const lines = raw.split(/\r?\n/);
  const turns: Turn[] = [];
  let speaker: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join(" ").replace(/\s+/g, " ").trim();
    if (text && speaker) turns.push({ index: 0, speaker, text });
    buffer = [];
  };

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(SPEAKER_PREFIX);
    if (m && looksLikeSpeakerName(m[1])) {
      flush();
      speaker = cleanSpeaker(m[1]);
      buffer.push(m[2].trim());
    } else if (speaker) {
      buffer.push(t);
    }
  }
  flush();
  return turns;
}

/** Last resort: paragraphs with no speaker labels at all. */
function parseUnlabeled(raw: string): Turn[] {
  return raw
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((text) => ({ index: 0, speaker: "Unknown", text }));
}

function parseJson(raw: string): Turn[] {
  const data = JSON.parse(raw);
  const arr: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray((data as any).turns)
      ? (data as any).turns
      : Array.isArray((data as any).segments)
        ? (data as any).segments
        : Array.isArray((data as any).monologues)
          ? (data as any).monologues
          : [];

  if (arr.length === 0) {
    throw new Error(
      "JSON transcript: expected an array, or an object with a `turns`, `segments`, or `monologues` array.",
    );
  }

  return arr.map((item: any) => {
    const speaker = String(
      item.speaker ?? item.speaker_name ?? item.name ?? item.speaker_label ?? "Unknown",
    );
    const text = String(item.text ?? item.content ?? item.transcript ?? item.words ?? "").trim();
    const startSec =
      typeof item.start === "number"
        ? item.start
        : typeof item.start_time === "number"
          ? item.start_time
          : typeof item.startSec === "number"
            ? item.startSec
            : undefined;
    const endSec =
      typeof item.end === "number"
        ? item.end
        : typeof item.end_time === "number"
          ? item.end_time
          : typeof item.endSec === "number"
            ? item.endSec
            : undefined;
    return { index: 0, speaker: cleanSpeaker(speaker), text, startSec, endSec };
  }).filter((t) => t.text.length > 0);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function mergeConsecutive(turns: Turn[]): Turn[] {
  const out: Turn[] = [];
  for (const t of turns) {
    const prev = out[out.length - 1];
    if (prev && prev.speaker === t.speaker) {
      prev.text = `${prev.text} ${t.text}`.replace(/\s+/g, " ").trim();
      if (t.endSec !== undefined) prev.endSec = t.endSec;
    } else {
      out.push({ ...t });
    }
  }
  return out;
}

function applyAliases(turns: Turn[], aliases: Record<string, string>): Turn[] {
  const merged = turns.map((t) => ({ ...t, speaker: aliases[t.speaker] ?? t.speaker }));
  // Aliasing can make neighbours match, so merge again.
  return mergeConsecutive(merged);
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}

function cleanSpeaker(s: string): string {
  return s.replace(/\s+/g, " ").replace(/[:\-–—]+$/, "").trim() || "Unknown";
}

/**
 * Guards against treating ordinary prose containing a colon as a speaker label
 * ("The problem is this: nobody listens"). Speaker names are short and are not
 * full sentences.
 */
function looksLikeSpeakerName(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 50) return false;
  if (t.split(/\s+/).length > 5) return false;
  if (/[.!?]$/.test(t)) return false;
  return /^[A-Za-z0-9]/.test(t);
}

/** Stable, dependency-free id from content. FNV-1a; not a security hash. */
function contentId(raw: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `conv_${(h >>> 0).toString(16).padStart(8, "0")}`;
}

export function wordCount(s: string): number {
  const m = s.trim().match(/\S+/g);
  return m ? m.length : 0;
}

/** Turn list rendered for the judge prompt, with indices the model must cite. */
export function renderTurns(turns: Turn[]): string {
  return turns.map((t) => `[${t.index}] ${t.speaker}: ${t.text}`).join("\n");
}
