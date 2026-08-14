/**
 * Audio to transcript.
 *
 * Bridging organizations record conversations; almost none of them transcribe
 * consistently, which is a large part of why the recordings never turn into
 * anything reportable. This module closes that gap using tools already on the
 * machine, so participant audio stays local.
 *
 * Diarization is the hard part. Whisper and its variants produce excellent text
 * with no idea who was speaking, and per-speaker scores are the whole point
 * here. Two ways out, in order of preference:
 *
 *   1. Multitrack. Zoom, Teams, Riverside, and most conferencing tools can
 *      record one audio file per participant. Filename becomes the speaker
 *      name, tracks are transcribed separately and merged by timestamp, and
 *      diarization is exact. If an organization can
 *      change one recording setting, this is the setting.
 *   2. Single track. Transcribed as one stream and returned with speaker
 *      labels absent. Guessed speakers produce confidently
 *      wrong per-speaker scores.
 */

import { execFile } from "node:child_process";
import { readdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const AUDIO_EXT = new Set([".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"]);

export function isMediaFile(p: string): boolean {
  const ext = path.extname(p).toLowerCase();
  return AUDIO_EXT.has(ext) || VIDEO_EXT.has(ext);
}

export interface Backend {
  /** Executable name as invoked. */
  command: string;
  kind: "openai-whisper" | "whisper-cpp" | "mlx-whisper" | "faster-whisper";
  label: string;
}

/** Backends in preference order: quality and VTT support first. */
const CANDIDATES: Array<Omit<Backend, "command"> & { commands: string[] }> = [
  {
    kind: "mlx-whisper",
    label: "mlx-whisper (Apple Silicon, fast, local)",
    commands: ["mlx_whisper"],
  },
  {
    kind: "openai-whisper",
    label: "openai-whisper (local)",
    commands: ["whisper"],
  },
  {
    kind: "faster-whisper",
    label: "faster-whisper (local)",
    commands: ["faster-whisper"],
  },
  {
    kind: "whisper-cpp",
    label: "whisper.cpp (local, no Python)",
    commands: ["whisper-cli", "whisper-cpp"],
  },
];

export interface Capabilities {
  ffmpeg: boolean;
  backends: Backend[];
  /** True when at least one transcription path exists. */
  canTranscribe: boolean;
}

export async function detectCapabilities(): Promise<Capabilities> {
  const ffmpeg = await which("ffmpeg");
  const backends: Backend[] = [];
  for (const cand of CANDIDATES) {
    for (const cmd of cand.commands) {
      if (await which(cmd)) {
        backends.push({ command: cmd, kind: cand.kind, label: cand.label });
        break;
      }
    }
  }
  return { ffmpeg, backends, canTranscribe: backends.length > 0 };
}

async function which(cmd: string): Promise<boolean> {
  try {
    await run("command", ["-v", cmd], { shell: "/bin/sh" } as any);
    return true;
  } catch {
    try {
      await run("which", [cmd]);
      return true;
    } catch {
      return false;
    }
  }
}

export const INSTALL_HELP = `No local transcription backend was found. Install any one of these, then retry:

  Apple Silicon, fastest:   pip install mlx-whisper
  Cross-platform:           pip install -U openai-whisper
  No Python:                brew install whisper-cpp
  Also recommended:         brew install ffmpeg   (needed for video files and multitrack)
`;

export interface TranscribeOptions {
  /** Whisper model size. Smaller is faster and less accurate. */
  model?: string;
  language?: string;
  /** Force a specific backend command. */
  backend?: string;
}

export interface TranscribeResult {
  /** WebVTT text, ready for parseTranscript. */
  vtt: string;
  backend: string;
  speakerLabeled: boolean;
  notes: string[];
}

/* ------------------------------------------------------------------ */
/* Single file                                                         */
/* ------------------------------------------------------------------ */

export async function transcribeFile(
  filePath: string,
  opts: TranscribeOptions = {},
): Promise<TranscribeResult> {
  const caps = await detectCapabilities();
  if (!caps.canTranscribe) throw new Error(INSTALL_HELP);

  const abs = path.resolve(filePath);
  if (!existsSync(abs)) throw new Error(`No such file: ${abs}`);

  const backend = pickBackend(caps, opts.backend);
  const notes: string[] = [];

  const ext = path.extname(abs).toLowerCase();
  let source = abs;
  let tmp: string | null = null;

  if (VIDEO_EXT.has(ext)) {
    if (!caps.ffmpeg) {
      throw new Error(
        `${abs} is a video file and ffmpeg is not installed, so the audio cannot be extracted. Install ffmpeg (brew install ffmpeg) or supply an audio file.`,
      );
    }
    tmp = await mkdtemp(path.join(os.tmpdir(), "turnwise-"));
    source = path.join(tmp, "audio.wav");
    await run("ffmpeg", ["-i", abs, "-ac", "1", "-ar", "16000", "-vn", "-y", source]);
    notes.push("Audio extracted from video with ffmpeg at 16 kHz mono.");
  }

  try {
    const vtt = await runBackend(backend, source, opts);
    notes.push(
      "Single-track audio: the transcript has no speaker labels, because automatic speaker separation is not reliable enough to base per-speaker scores on.",
      "For per-speaker scores, re-record with one audio file per participant (Zoom: Settings > Recording > 'Record a separate audio file for each participant') and use transcribe_session on the folder.",
    );
    return { vtt, backend: backend.command, speakerLabeled: false, notes };
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* Multitrack                                                          */
/* ------------------------------------------------------------------ */

export interface SessionOptions extends TranscribeOptions {
  /** Map filenames onto speaker names. Otherwise derived from the filename. */
  speakerNames?: Record<string, string>;
}

/**
 * Transcribe a folder of per-speaker recordings and interleave them by
 * timestamp into a single speaker-labeled transcript.
 *
 * Each track contains exactly one person, so attribution is exact. This is the
 * recommended path.
 */
export async function transcribeSession(
  dir: string,
  opts: SessionOptions = {},
): Promise<TranscribeResult> {
  const caps = await detectCapabilities();
  if (!caps.canTranscribe) throw new Error(INSTALL_HELP);

  const absDir = path.resolve(dir);
  const entries = await readdir(absDir).catch(() => {
    throw new Error(`Could not read directory: ${absDir}`);
  });
  const media = entries.filter((f) => isMediaFile(f)).sort();

  if (media.length === 0) {
    throw new Error(`No audio or video files found in ${absDir}.`);
  }
  if (media.length === 1) {
    return transcribeFile(path.join(absDir, media[0]), opts);
  }

  const backend = pickBackend(caps, opts.backend);
  const cues: Cue[] = [];
  const speakers: string[] = [];

  for (const file of media) {
    const speaker = opts.speakerNames?.[file] ?? speakerFromFilename(file);
    speakers.push(speaker);
    const vtt = await runBackend(backend, path.join(absDir, file), opts);
    for (const cue of parseVttCues(vtt)) {
      cues.push({ ...cue, speaker });
    }
  }

  cues.sort((a, b) => a.start - b.start);
  const merged = mergeAdjacent(cues);

  return {
    vtt: cuesToVtt(merged),
    backend: backend.command,
    speakerLabeled: true,
    notes: [
      `Merged ${media.length} per-speaker tracks into one transcript: ${speakers.join(", ")}.`,
      "Each track contains one participant, so speaker attribution is exact.",
      "Cross-talk appears as adjacent turns ordered by start time.",
    ],
  };
}

/** "01-Dana Whitfield.m4a" -> "Dana Whitfield" */
export function speakerFromFilename(file: string): string {
  const base = path.basename(file, path.extname(file));
  return (
    base
      // Zoom writes "audio<digits>" and leading track numbers.
      .replace(/^audio\d*[-_ ]*/i, "")
      .replace(/^\d+[-_. ]+/, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || base
  );
}

/* ------------------------------------------------------------------ */
/* Backend invocation                                                  */
/* ------------------------------------------------------------------ */

function pickBackend(caps: Capabilities, requested?: string): Backend {
  if (requested) {
    const found = caps.backends.find((b) => b.command === requested);
    if (!found) {
      throw new Error(
        `Backend "${requested}" is not available. Found: ${caps.backends.map((b) => b.command).join(", ") || "none"}.`,
      );
    }
    return found;
  }
  return caps.backends[0];
}

async function runBackend(
  backend: Backend,
  file: string,
  opts: TranscribeOptions,
): Promise<string> {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "turnwise-out-"));
  try {
    const model = opts.model ?? defaultModel(backend);
    const args = buildArgs(backend, file, outDir, model, opts.language);
    await run(backend.command, args, { maxBuffer: 64 * 1024 * 1024 });

    const produced = (await readdir(outDir)).filter((f) => f.endsWith(".vtt"));
    if (produced.length === 0) {
      throw new Error(
        `${backend.command} produced no VTT output. Check that the model "${model}" is available.`,
      );
    }
    return await readFile(path.join(outDir, produced[0]), "utf8");
  } finally {
    await rm(outDir, { recursive: true, force: true }).catch(() => {});
  }
}

function defaultModel(backend: Backend): string {
  // Small is the accuracy/speed knee for conversational speech on CPU.
  switch (backend.kind) {
    case "mlx-whisper":
      return "mlx-community/whisper-small-mlx";
    case "whisper-cpp":
      return "small";
    default:
      return "small";
  }
}

function buildArgs(
  backend: Backend,
  file: string,
  outDir: string,
  model: string,
  language?: string,
): string[] {
  switch (backend.kind) {
    case "openai-whisper":
      return [
        file,
        "--model", model,
        "--output_format", "vtt",
        "--output_dir", outDir,
        ...(language ? ["--language", language] : []),
      ];
    case "mlx-whisper":
      return [
        file,
        "--model", model,
        "--output-format", "vtt",
        "--output-dir", outDir,
        ...(language ? ["--language", language] : []),
      ];
    case "faster-whisper":
      return [
        file,
        "--model", model,
        "--output_format", "vtt",
        "--output_dir", outDir,
        ...(language ? ["--language", language] : []),
      ];
    case "whisper-cpp":
      return [
        "-f", file,
        "-m", model,
        "-ovtt",
        "-of", path.join(outDir, "out"),
        ...(language ? ["-l", language] : []),
      ];
  }
}

/* ------------------------------------------------------------------ */
/* VTT cue handling                                                    */
/* ------------------------------------------------------------------ */

interface Cue {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

export function parseVttCues(vtt: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = vtt.split(/\r?\n\s*\r?\n/);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter(Boolean);
    const tcIdx = lines.findIndex((l) => l.includes("-->"));
    if (tcIdx === -1) continue;
    const [a, b] = lines[tcIdx].split("-->");
    const start = toSeconds(a);
    const end = toSeconds(b);
    const text = lines
      .slice(tcIdx + 1)
      .join(" ")
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text && start !== null) cues.push({ start, end: end ?? start, text });
  }
  return cues;
}

function toSeconds(s: string): number | null {
  const m = s.trim().match(/(\d{1,3}):(\d{2}):(\d{2})[.,](\d{1,3})/);
  if (m) {
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000;
  }
  const short = s.trim().match(/(\d{1,3}):(\d{2})[.,](\d{1,3})/);
  if (short) {
    return Number(short[1]) * 60 + Number(short[2]) + Number(short[3].padEnd(3, "0")) / 1000;
  }
  return null;
}

/** Collapse consecutive cues from one speaker into a single turn. */
function mergeAdjacent(cues: Cue[]): Cue[] {
  const out: Cue[] = [];
  for (const cue of cues) {
    const prev = out[out.length - 1];
    // A gap over two seconds is a real pause, so keep it as a separate turn.
    if (prev && prev.speaker === cue.speaker && cue.start - prev.end < 2) {
      prev.text = `${prev.text} ${cue.text}`.trim();
      prev.end = cue.end;
    } else {
      out.push({ ...cue });
    }
  }
  return out;
}

function cuesToVtt(cues: Cue[]): string {
  const lines = ["WEBVTT", ""];
  cues.forEach((c, i) => {
    lines.push(String(i + 1));
    lines.push(`${fromSeconds(c.start)} --> ${fromSeconds(c.end)}`);
    lines.push(c.speaker ? `<v ${c.speaker}>${c.text}` : c.text);
    lines.push("");
  });
  return lines.join("\n");
}

function fromSeconds(t: number): string {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t - Math.floor(t)) * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)}.${p(ms, 3)}`;
}
