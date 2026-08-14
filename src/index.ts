#!/usr/bin/env node
/**
 * turnwise
 *
 * Scores dialogue transcripts for bridging quality and returns the exact spans
 * with quoted evidence for each score. Runs over stdio.
 *
 * Scoring is deterministic, so the same transcript always produces the same
 * numbers, which is what lets one year be compared against another.
 *
 * The division of labor: this server measures, the model that calls it
 * interprets. `extract_evidence` exists for exactly that handoff.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  INSTALL_HELP,
  detectCapabilities,
  transcribeFile,
  transcribeSession,
} from "./audio.js";
import { buildCohortReport } from "./cohort.js";
import { extractHits } from "./linguistic.js";
import { computeStructure } from "./metrics.js";
import { parseTranscript } from "./parse.js";
import {
  renderCohortReport,
  renderConversationReport,
  renderIndicatorExplainer,
} from "./report.js";
import { INDICATOR_KEYS, RUBRICS, type IndicatorKey } from "./rubrics.js";
import {
  ENGINE,
  RUBRIC_VERSION,
  buildEvidencePackage,
  scoreConversation,
} from "./score.js";
import type { ConversationScore } from "./types.js";

const VERSION = "0.2.0";

const server = new McpServer(
  { name: "turnwise", version: VERSION },
  {
    instructions: [
      "turnwise measures dialogue transcripts for bridging quality: receptiveness, perspective-taking, contempt, curiosity, concession, and personal disclosure.",
      "",
      "It is a deterministic instrument. Marker matching is exact and reproducible, every score decomposes into quoted spans with character offsets.",
      "",
      "You supply the judgment. Use score_conversation for the numbers, then extract_evidence when the reading matters: it hands you every pattern match to confirm or reject, plus the turns where no pattern fired and a word list is most likely to have missed something.",
      "",
      "When relaying results, keep each number attached to the quote it rests on, pass along confidence values and warnings, and do not describe these as measurements of the participants.",
    ].join("\n"),
  },
);

/* ------------------------------------------------------------------ */
/* Shared input                                                        */
/* ------------------------------------------------------------------ */

const transcriptInput = {
  transcript: z.string().optional().describe("Raw transcript text. Supply this or transcript_path."),
  transcript_path: z
    .string()
    .optional()
    .describe("Path to a transcript file. Supply this or transcript."),
  format: z
    .enum(["vtt", "srt", "otter", "speaker_colon", "json", "unknown"])
    .optional()
    .describe("Override format auto-detection."),
  speaker_aliases: z
    .record(z.string())
    .optional()
    .describe(
      'Rename speakers after parsing, e.g. {"Speaker 1": "Participant A"}. Use this to de-identify before results are shared.',
    ),
  meta: z
    .record(z.string())
    .optional()
    .describe(
      'Labels carried into the report and used for cohort grouping, e.g. {"cohort": "spring-2026", "site": "Cleveland"}.',
    ),
};

async function loadTranscript(args: {
  transcript?: string;
  transcript_path?: string;
}): Promise<string> {
  if (args.transcript?.trim()) return args.transcript;
  if (args.transcript_path) {
    const p = path.resolve(args.transcript_path);
    try {
      return await readFile(p, "utf8");
    } catch (err) {
      throw new Error(`Could not read transcript at ${p}: ${(err as Error).message}`);
    }
  }
  throw new Error("Supply either `transcript` text or a `transcript_path`.");
}

function asIndicators(list?: string[]): IndicatorKey[] | undefined {
  if (!list?.length) return undefined;
  const bad = list.filter((k) => !INDICATOR_KEYS.includes(k as IndicatorKey));
  if (bad.length) {
    throw new Error(`Unknown indicator(s): ${bad.join(", ")}. Valid: ${INDICATOR_KEYS.join(", ")}.`);
  }
  return list as IndicatorKey[];
}

function result(markdown: string, structured: unknown) {
  return {
    content: [
      { type: "text" as const, text: markdown },
      {
        type: "text" as const,
        text: `\n<structured_data>\n${JSON.stringify(structured, null, 2)}\n</structured_data>`,
      },
    ],
  };
}

function failure(err: unknown) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
  };
}

/* ------------------------------------------------------------------ */
/* Transcript tools                                                    */
/* ------------------------------------------------------------------ */

server.registerTool(
  "parse_transcript",
  {
    title: "Parse a transcript",
    description:
      "Normalize a transcript into speaker turns and compute structural metrics: turn counts, airtime share per speaker, airtime concentration, and question rate. Run this when a transcript's format is uncertain, to confirm speakers were detected correctly before scoring.",
    inputSchema: transcriptInput,
  },
  async (args) => {
    try {
      const raw = await loadTranscript(args);
      const conv = parseTranscript(raw, {
        format: args.format,
        meta: args.meta,
        speakerAliases: args.speaker_aliases,
      });
      const structure = computeStructure(conv);

      const lines = [
        `# Parsed: ${conv.id}`,
        "",
        `Detected ${conv.sourceFormat}: ${structure.turnCount} turns and ${structure.wordCount.toLocaleString()} words across ${structure.speakerCount} speakers.`,
        "",
        "| Speaker | Turns | Words | Airtime | Question turns | Mean words/turn |",
        "| --- | --- | --- | --- | --- | --- |",
        ...structure.perSpeaker.map(
          (p) =>
            `| ${p.speaker} | ${p.turns} | ${p.words} | ${(p.airtimeShare * 100).toFixed(0)}% | ${p.questionTurns} | ${p.meanWordsPerTurn} |`,
        ),
        "",
        `Airtime Gini is ${structure.airtimeGini.toFixed(2)}, and questions appear in ${(structure.questionRate * 100).toFixed(0)}% of turns.`,
        "",
        "First turns as parsed:",
        "",
        ...conv.turns
          .slice(0, 5)
          .map(
            (t) =>
              `- **[${t.index}] ${t.speaker}:** ${t.text.slice(0, 150)}${t.text.length > 150 ? "..." : ""}`,
          ),
      ];

      if (conv.speakers.includes("Unknown")) {
        lines.push(
          "",
          "Some turns had no detectable speaker label. Set `format` explicitly, or check that the source labels speakers.",
        );
      }

      return result(lines.join("\n"), { conversation: conv, structure });
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "transcribe_audio",
  {
    title: "Transcribe a recording",
    description:
      "Transcribe a single audio or video recording to WebVTT using a local speech model. Audio stays on this machine. A mixed track cannot be reliably split by speaker, so the result omits speaker labels and cannot produce per-speaker scores. For those, record one file per participant and use transcribe_session.",
    inputSchema: {
      file_path: z.string().describe("Path to an audio or video file."),
      model: z.string().optional().describe("Speech model size, e.g. tiny, base, small, medium."),
      language: z.string().optional().describe("Language code, e.g. en. Auto-detected if omitted."),
      backend: z.string().optional().describe("Force a specific backend command."),
    },
  },
  async (args) => {
    try {
      const res = await transcribeFile(args.file_path, {
        model: args.model,
        language: args.language,
        backend: args.backend,
      });
      const conv = parseTranscript(res.vtt, { format: "vtt" });
      const md = [
        `# Transcribed: ${path.basename(args.file_path)}`,
        "",
        `Backend ${res.backend} produced ${conv.turns.length} segments${res.speakerLabeled ? " with speaker labels." : " without speaker labels."}`,
        "",
        ...res.notes.map((n) => `- ${n}`),
        "",
        "## Transcript",
        "",
        "```",
        res.vtt.slice(0, 4000),
        res.vtt.length > 4000 ? "... (truncated in this view; full text is in the structured data)" : "",
        "```",
      ].join("\n");
      return result(md, { vtt: res.vtt, notes: res.notes, speakerLabeled: res.speakerLabeled });
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "transcribe_session",
  {
    title: "Transcribe a multitrack session",
    description:
      "Transcribe a folder of per-participant recordings and merge them into one speaker-labeled transcript ordered by timestamp. Each file contains exactly one person, so speaker attribution is exact. This is the recommended path for anything that needs per-speaker scores. In Zoom, enable Settings > Recording > 'Record a separate audio file for each participant'. Speaker names come from the filenames.",
    inputSchema: {
      directory: z.string().describe("Folder containing one audio file per participant."),
      speaker_names: z
        .record(z.string())
        .optional()
        .describe('Map filenames to speaker names, e.g. {"audio1234.m4a": "Dana"}.'),
      model: z.string().optional(),
      language: z.string().optional(),
      backend: z.string().optional(),
    },
  },
  async (args) => {
    try {
      const res = await transcribeSession(args.directory, {
        speakerNames: args.speaker_names,
        model: args.model,
        language: args.language,
        backend: args.backend,
      });
      const conv = parseTranscript(res.vtt, { format: "vtt" });
      const md = [
        `# Session transcribed: ${path.basename(args.directory)}`,
        "",
        `Backend ${res.backend} produced ${conv.turns.length} turns for ${conv.speakers.join(", ")}.`,
        "",
        ...res.notes.map((n) => `- ${n}`),
        "",
        "Pass the VTT from the structured data straight into score_conversation.",
      ].join("\n");
      return result(md, { vtt: res.vtt, speakers: conv.speakers, notes: res.notes });
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "check_audio_support",
  {
    title: "Check local transcription support",
    description:
      "Report which local speech-to-text backends and media tools are installed, with install instructions if none are. Use this before attempting transcription so a missing dependency surfaces as a clear answer.",
    inputSchema: {},
  },
  async () => {
    try {
      const caps = await detectCapabilities();
      const lines = [
        "# Local transcription support",
        "",
        `ffmpeg (needed for video and multitrack): ${caps.ffmpeg ? "installed" : "not found"}`,
        "",
        caps.backends.length
          ? ["Speech backends found:", "", ...caps.backends.map((b) => `- \`${b.command}\`: ${b.label}`)].join("\n")
          : `No speech backend found.\n\n${INSTALL_HELP}`,
        "",
        caps.canTranscribe
          ? "Transcription is available."
          : "Transcription is unavailable until one backend is installed. Text transcripts still work.",
      ];
      return result(lines.join("\n"), caps);
    } catch (err) {
      return failure(err);
    }
  },
);

/* ------------------------------------------------------------------ */
/* Scoring tools                                                       */
/* ------------------------------------------------------------------ */

server.registerTool(
  "score_conversation",
  {
    title: "Score a dialogue transcript",
    description:
      "Score a conversation for bridging quality. Returns a 0-4 score per speaker per indicator (receptiveness, perspective-taking, contempt, curiosity, concession, personal disclosure), each with quoted evidence anchored to turn numbers, a confidence value, and deterministic airtime metrics. Set arc_segments to 3 to see how the conversation changed from opening to close.",
    inputSchema: {
      ...transcriptInput,
      indicators: z
        .array(z.enum(INDICATOR_KEYS as [string, ...string[]]))
        .optional()
        .describe("Subset of indicators. Defaults to all six."),
      arc_segments: z
        .number()
        .int()
        .min(0)
        .max(6)
        .optional()
        .describe("Split into this many slices and score each. 3 is the usual choice."),
    },
  },
  async (args) => {
    try {
      const raw = await loadTranscript(args);
      const conv = parseTranscript(raw, {
        format: args.format,
        meta: args.meta,
        speakerAliases: args.speaker_aliases,
      });
      const score = scoreConversation(conv, {
        indicators: asIndicators(args.indicators),
        arcSegments: args.arc_segments,
      });
      const { features, ...reportable } = score;
      return result(renderConversationReport(reportable), reportable);
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "extract_evidence",
  {
    title: "Get raw evidence for your own judgment",
    description:
      "Return every pattern match the instrument found, with the quote and the rule that fired, plus the turns where nothing matched. Use this when the reading matters more than the number: you confirm or reject each candidate yourself, catching sarcasm and quoted speech that a word list scores wrong, and catching behavior in the unmatched turns that no pattern covers. This is the tool for producing a defensible qualitative summary.",
    inputSchema: {
      ...transcriptInput,
      indicators: z.array(z.enum(INDICATOR_KEYS as [string, ...string[]])).optional(),
    },
  },
  async (args) => {
    try {
      const raw = await loadTranscript(args);
      const conv = parseTranscript(raw, {
        format: args.format,
        meta: args.meta,
        speakerAliases: args.speaker_aliases,
      });
      const indicators = asIndicators(args.indicators) ?? INDICATOR_KEYS;
      const hits = extractHits(conv, indicators);
      const pkg = buildEvidencePackage(conv, hits, indicators);

      const md = [
        `# Evidence for ${conv.id}`,
        "",
        `${pkg.candidates.length} pattern matches across ${conv.turns.length} turns. ${pkg.unmatchedTurns.length} turns matched nothing.`,
        "",
        "## Candidates to confirm or reject",
        "",
        ...pkg.candidates.map(
          (c) =>
            `- ${c.label} ${c.direction === "supports" ? "supports" : "counts against"}, from ${c.speaker} at turn ${c.turnIndex}, matched by the rule "${c.rule}".\n  > "${c.quote}"`,
        ),
        "",
        "## Turns with no pattern match",
        "",
        "A word list is weakest here. Read for anything the patterns would miss.",
        "",
        ...pkg.unmatchedTurns
          .slice(0, 40)
          .map((t) => `- **[${t.turnIndex}] ${t.speaker}:** ${t.text.slice(0, 200)}${t.text.length > 200 ? "..." : ""}`),
        "",
        "## How to use this",
        "",
        ...pkg.reviewGuidance.map((g) => `- ${g}`),
      ].join("\n");

      return result(md, pkg);
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "compare_conversations",
  {
    title: "Compare two conversations",
    description:
      "Score two transcripts and lay them side by side with the difference on each indicator. Use for before/after comparisons: the same group early and late in a program, one workshop format against another, or a facilitator's first session against their tenth.",
    inputSchema: {
      transcript_a: z.string().optional(),
      transcript_a_path: z.string().optional(),
      label_a: z.string().optional().describe("Name for the first conversation, e.g. 'Session 1'."),
      transcript_b: z.string().optional(),
      transcript_b_path: z.string().optional(),
      label_b: z.string().optional().describe("Name for the second conversation, e.g. 'Session 6'."),
      indicators: z.array(z.enum(INDICATOR_KEYS as [string, ...string[]])).optional(),
    },
  },
  async (args) => {
    try {
      const indicators = asIndicators(args.indicators);
      const labelA = args.label_a ?? "A";
      const labelB = args.label_b ?? "B";

      const rawA = await loadTranscript({
        transcript: args.transcript_a,
        transcript_path: args.transcript_a_path,
      });
      const rawB = await loadTranscript({
        transcript: args.transcript_b,
        transcript_path: args.transcript_b_path,
      });

      const a = scoreConversation(parseTranscript(rawA, { meta: { label: labelA } }), { indicators });
      const b = scoreConversation(parseTranscript(rawB, { meta: { label: labelB } }), { indicators });

      const lines = [
        `# ${labelA} compared with ${labelB}`,
        "",
        `| Indicator | ${labelA} | ${labelB} | Change | |`,
        "| --- | --- | --- | --- | --- |",
      ];
      for (const m of a.conversationMeans) {
        const other = b.conversationMeans.find((x) => x.indicator === m.indicator);
        const delta = m.mean !== null && other?.mean != null ? other.mean - m.mean : null;
        const dir =
          delta === null || delta === 0
            ? ""
            : (m.valence === "positive") === delta > 0
              ? "favorable"
              : "unfavorable";
        lines.push(
          `| ${m.label} | ${m.mean?.toFixed(2) ?? "n/a"} | ${other?.mean?.toFixed(2) ?? "n/a"} | ${delta === null ? "n/a" : `${delta > 0 ? "+" : ""}${delta.toFixed(2)}`} | ${dir} |`,
        );
      }
      lines.push(
        "",
        "Two conversations differ for many reasons besides the intervention: who was in the room, the topic, the day. This describes two sessions.",
      );

      const { features: _fa, ...ra } = a;
      const { features: _fb, ...rb } = b;
      return result(lines.join("\n"), { a: ra, b: rb });
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "analyze_cohort",
  {
    title: "Aggregate across many conversations",
    description:
      "Combine scores from multiple conversations into one report: per-indicator means, spread, and optional group comparison with effect size. This is the tool that produces something a funder can read. Pass the structured score objects returned by score_conversation.",
    inputSchema: {
      scores: z
        .array(z.any())
        .describe("Structured score objects from score_conversation (its <structured_data> block)."),
      group_by: z
        .string()
        .optional()
        .describe('Meta key to group by, e.g. "cohort". With exactly two groups, effect sizes are included.'),
      indicators: z.array(z.enum(INDICATOR_KEYS as [string, ...string[]])).optional(),
    },
  },
  async (args) => {
    try {
      const report = buildCohortReport(args.scores as ConversationScore[], {
        groupBy: args.group_by,
        indicators: asIndicators(args.indicators),
      });
      return result(renderCohortReport(report), report);
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "explain_indicator",
  {
    title: "Explain an indicator",
    description:
      "Return the full rubric for one indicator: what it measures, what counts as evidence, what does not count, the 0-4 anchors, the thresholds, what the score cannot tell you, and the research behind it. Use whenever someone asks what a score means or challenges one.",
    inputSchema: {
      indicator: z.enum(INDICATOR_KEYS as [string, ...string[]]).describe("Which indicator."),
    },
  },
  async (args) => {
    try {
      return {
        content: [
          { type: "text" as const, text: renderIndicatorExplainer(args.indicator as IndicatorKey) },
        ],
      };
    } catch (err) {
      return failure(err);
    }
  },
);

/* ------------------------------------------------------------------ */
/* Resources                                                           */
/* ------------------------------------------------------------------ */

server.registerResource(
  "rubrics",
  "turnwise://rubrics",
  {
    title: "Indicator rubrics",
    description:
      "The indicator definitions, marker lists, scale anchors, limitations, and citations, as JSON. This is the published measurement definition. Any client can read it to check what the numbers mean.",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({ version: RUBRIC_VERSION, engine: ENGINE, indicators: RUBRICS }, null, 2),
      },
    ],
  }),
);

server.registerResource(
  "methodology",
  "turnwise://methodology",
  {
    title: "Methodology and validation status",
    description:
      "What these scores are, what they are not, how confidence is computed, and what would be needed to call them validated. Read before putting numbers in a report.",
    mimeType: "text/markdown",
  },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/markdown", text: METHODOLOGY }],
  }),
);

/* ------------------------------------------------------------------ */
/* Prompts                                                             */
/* ------------------------------------------------------------------ */

server.registerPrompt(
  "score_workshop",
  {
    title: "Score a workshop recording",
    description: "Score one transcript, verify the evidence, and write it up.",
    argsSchema: {
      transcript_path: z.string().describe("Path to the transcript file."),
      context: z.string().optional().describe("What the session was and what the facilitator intended."),
    },
  },
  ({ transcript_path, context }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            `Score the dialogue transcript at ${transcript_path}.`,
            context ? `\nContext: ${context}` : "",
            "",
            "Parse it first to confirm speakers were detected correctly. Then score it with arc_segments set to 3. Then call extract_evidence and check the pattern matches yourself, rejecting any that do not hold up and noting anything in the unmatched turns that the patterns missed.",
            "",
            "Write the summary for the facilitator. Lead with what actually happened in the conversation. Quote the evidence for anything you claim. Say plainly where confidence is low or where your reading differs from the automatic score.",
          ].join("\n"),
        },
      },
    ],
  }),
);

server.registerPrompt(
  "funder_report",
  {
    title: "Build a funder-facing summary",
    description: "Score a set of transcripts and aggregate them into a reportable summary.",
    argsSchema: {
      directory: z.string().describe("Directory containing transcript files."),
      program_name: z.string().describe("Program or cohort name."),
    },
  },
  ({ directory, program_name }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            `Score every transcript in ${directory} for the ${program_name} program, passing meta on each so they can be grouped, then aggregate with analyze_cohort.`,
            "",
            "Write for a program officer who will show this to a funder. Lead with the finding. Include the caveats from the cohort report verbatim rather than softening them, and include at least two participant quotes as illustration.",
            "",
            "Do not claim the program caused any difference you report. Participants were not randomly assigned, so differences are descriptive.",
          ].join("\n"),
        },
      },
    ],
  }),
);

/* ------------------------------------------------------------------ */

const METHODOLOGY = `# Methodology and validation status

## What this produces

For each speaker, a 0-4 score on six indicators, each decomposing into marker
matches with exact character offsets, plus deterministic airtime metrics.

## How scoring works

Pattern matching against a published marker lexicon, normalized to a rate per
100 words, then mapped to 0-4 through documented thresholds. Two signals are
computed rather than matched: follow-up questions, detected as questions reusing
content words from the previous speaker's turn, and reciprocated disclosure,
detected as personal disclosure following someone else's within two turns.

The whole pipeline is arithmetic over pattern matches, so the same transcript
always produces identical output. That is what makes
comparison across a year of workshops meaningful. A model-judged score silently
changes when the model does.

## What the scores are not

Not validated instrument scores. Nobody has yet established inter-rater
reliability against trained human coders on this rubric. Read them as structured,
evidence-linked observations, short of measurement.

Known limits:

- The thresholds mapping density to 0-4 are calibrated against a small fixture
  set. They are exported in the code and should be re-fit against a hand-coded
  reference set.
- Pattern matching has no context. Sarcastic agreement, quoted speech, and
  someone repeating another's words to criticize them all match patterns they
  should not. Use extract_evidence and adjudicate them.
- Contempt is systematically undercounted. Tone of voice, facial expression, and
  eye-rolling are how contempt is usually identified, and none of it survives
  into a transcript. Confidence for this indicator is capped accordingly.
- Rate-based scores over very short contributions are unstable, which is why
  confidence scales with word count.
- Transcription errors propagate. A garbled auto-transcript produces garbled scores.
- Scores describe expressed behavior in one conversation. They say nothing about
  what a participant believes or how they behave elsewhere.

## Confidence

Computed from how much text the score rests on and how many markers fired, not
from anything self-reported. Below 0.5, read the evidence before using the number.

## Using this in a report

Report the evidence alongside the number and keep the caveats. Do not claim a
program caused a difference between groups: participants were not randomly
assigned, so a difference between groups describes those groups.

## What would make these validated

1. A hand-coded reference set from trained coders on real bridging transcripts.
2. Inter-rater reliability between coders, then between coders and this tool,
   reported per indicator.
3. Thresholds re-fit against that reference set rather than against fixtures.
4. Calibration against existing self-report instruments on the same sessions.

Until then this is instrumented observation with its work shown, which is more
than a recording sitting in a folder.
`;

async function main() {
  await server.connect(new StdioServerTransport());
  // stderr only: stdout carries the protocol.
  process.stderr.write(
    `turnwise ${VERSION} (rubric v${RUBRIC_VERSION}, engine ${ENGINE}) ready on stdio\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`turnwise failed to start: ${err?.stack ?? err}\n`);
  process.exit(1);
});
