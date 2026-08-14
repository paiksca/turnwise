import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { runCalibration } from "./calibrate.js";
import {
  densityToScore,
  detectFollowUpQuestions,
  extractHits,
  scoreLinguistic,
} from "./linguistic.js";
import { computeStructure, gini, cohensD, segmentTurns } from "./metrics.js";
import { detectFormat, parseTranscript } from "./parse.js";
import { speakerFromFilename, parseVttCues } from "./audio.js";
import { scoreConversation } from "./score.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "..", "fixtures");
const read = (name: string) => readFileSync(path.join(fixtures, name), "utf8");

test("detects WebVTT", () => {
  assert.equal(detectFormat(read("housing-workshop.vtt")), "vtt");
});

test("detects speaker-colon plain text", () => {
  assert.equal(detectFormat(read("contentious-thread.txt")), "speaker_colon");
});

test("parses VTT voice tags into speakers and turns", () => {
  const conv = parseTranscript(read("housing-workshop.vtt"));
  assert.deepEqual(conv.speakers.sort(), ["Dana", "Facilitator", "Marcus"]);
  assert.equal(conv.turns[0].speaker, "Facilitator");
  assert.match(conv.turns[0].text, /zoning change on Ridge Road/);
  // Indices are contiguous from zero.
  conv.turns.forEach((t, i) => assert.equal(t.index, i));
});

test("carries VTT timestamps through to turns", () => {
  const conv = parseTranscript(read("housing-workshop.vtt"));
  assert.ok(conv.turns[0].startSec !== undefined);
  assert.ok(Math.abs(conv.turns[0].startSec! - 4.12) < 0.01);
});

test("parses speaker-colon transcripts", () => {
  const conv = parseTranscript(read("contentious-thread.txt"));
  assert.deepEqual(conv.speakers.sort(), ["Riley", "Sam"]);
  assert.ok(conv.turns.length >= 10);
});

test("merges consecutive turns from the same speaker", () => {
  const conv = parseTranscript("Ana: first part.\nAna: second part.\nBo: reply.");
  assert.equal(conv.turns.length, 2);
  assert.equal(conv.turns[0].text, "first part. second part.");
});

test("does not treat mid-sentence colons as speaker labels", () => {
  const conv = parseTranscript(
    "Ana: Here is the thing: nobody actually read it.\nBo: I read it.",
  );
  assert.equal(conv.turns.length, 2);
  assert.equal(conv.turns[0].speaker, "Ana");
  assert.match(conv.turns[0].text, /Here is the thing: nobody/);
});

test("applies speaker aliases and re-merges", () => {
  const conv = parseTranscript("Speaker 1: hello.\nSpeaker 2: hi.\nSpeaker 1: again.", {
    speakerAliases: { "Speaker 1": "Participant A", "Speaker 2": "Participant B" },
  });
  assert.deepEqual(conv.speakers, ["Participant A", "Participant B"]);
});

test("parses JSON transcripts in several shapes", () => {
  const flat = parseTranscript(
    JSON.stringify([
      { speaker: "Ana", text: "one", start: 0, end: 2 },
      { speaker: "Bo", text: "two", start: 2, end: 4 },
    ]),
  );
  assert.equal(flat.turns.length, 2);
  assert.equal(flat.turns[1].startSec, 2);

  const nested = parseTranscript(
    JSON.stringify({ segments: [{ speaker_name: "Ana", content: "hello" }] }),
  );
  assert.equal(nested.turns[0].speaker, "Ana");
});

test("structure metrics compute airtime and question rate", () => {
  const conv = parseTranscript("Ana: one two three four.\nBo: five?\nAna: six seven.");
  const s = computeStructure(conv);
  assert.equal(s.turnCount, 3);
  assert.equal(s.wordCount, 7);
  assert.equal(s.speakerCount, 2);
  const ana = s.perSpeaker.find((p) => p.speaker === "Ana")!;
  assert.ok(Math.abs(ana.airtimeShare - 6 / 7) < 0.001);
  assert.ok(Math.abs(s.questionRate - 1 / 3) < 0.001);
});

test("gini is zero for even distribution and high for concentrated", () => {
  assert.equal(gini([50, 50]), 0);
  assert.ok(gini([100, 0]) > 0.4);
  assert.equal(gini([10]), 0);
});

test("cohensD needs two per group and reports pooled effect", () => {
  assert.equal(cohensD([1], [2, 3]), null);
  // Zero within-group variance leaves the pooled SD at zero, so d is undefined.
  assert.equal(cohensD([4, 4, 4, 4], [1, 1, 1, 1]), null);
  const d = cohensD([4, 3, 4, 3], [1, 2, 1, 2]);
  assert.ok(d !== null && d > 1, `expected a large positive effect, got ${d}`);
});

test("segmentTurns splits into contiguous non-overlapping ranges", () => {
  const ranges = segmentTurns(10, 3);
  assert.equal(ranges.length, 3);
  assert.equal(ranges[0].from, 0);
  assert.equal(ranges[ranges.length - 1].to, 9);
  for (let i = 1; i < ranges.length; i++) {
    assert.equal(ranges[i].from, ranges[i - 1].to + 1);
  }
});


/* --- the deterministic engine, where correctness actually lives --- */

const conv = (text: string) => parseTranscript(text);

test("marker hits carry exact offsets into the source text", () => {
  const c = conv("Ana: I hear you, and I think that makes sense.\nBo: Fine.");
  const hits = extractHits(c, ["receptiveness"]);
  assert.ok(hits.length > 0);
  for (const h of hits) {
    const slice = c.turns[h.turnIndex].text.slice(h.charStart, h.charEnd);
    assert.equal(slice.toLowerCase(), h.match.toLowerCase());
  }
});

test("hollow acknowledgment scores below plain disagreement", () => {
  const hollow = scoreLinguistic(
    conv("Ana: I hear you, but that is completely wrong.\nBo: Okay."),
    ["receptiveness"],
  );
  const plain = scoreLinguistic(conv("Ana: I disagree with that.\nBo: Okay."), [
    "receptiveness",
  ]);
  const h = hollow.speakers.find((s) => s.speaker === "Ana")!.densities.receptiveness;
  const p = plain.speakers.find((s) => s.speaker === "Ana")!.densities.receptiveness;
  assert.ok(h <= p, `hollow ${h} should not exceed plain ${p}`);
});

test("a withdrawn concession does not count as a concession", () => {
  const withdrawn = scoreLinguistic(
    conv("Ana: You're right, but it does not matter at all here.\nBo: Hm."),
    ["concession"],
  );
  const granted = scoreLinguistic(
    conv("Ana: You're right about that, I had not considered it.\nBo: Hm."),
    ["concession"],
  );
  const w = withdrawn.scores.get("Ana")![0];
  const g = granted.scores.get("Ana")![0];
  assert.ok((g.count ?? 0) > (w.count ?? 0), `granted ${g.count} vs withdrawn ${w.count}`);
});

test("detects a follow-up question by content-word overlap", () => {
  const c = conv(
    "Ana: My sister drives forty minutes home from the hospital after every shift.\nBo: How long has your sister been driving that hospital shift?",
  );
  const follow = detectFollowUpQuestions(c.turns);
  assert.equal(follow.length, 1);
  assert.equal(follow[0].speaker, "Bo");
  assert.ok(follow[0].sharedTerms.length >= 2);
});

test("a topic-switching question is not a follow-up", () => {
  const c = conv(
    "Ana: My sister drives home from the hospital after every shift.\nBo: What do you think about the parking meter proposal downtown?",
  );
  assert.equal(detectFollowUpQuestions(c.turns).length, 0);
});

test("contempt fires on person-directed attacks and stays quiet on hard disagreement", () => {
  const nasty = scoreLinguistic(
    conv("Ana: Congratulations, that is a stupid take and you are being ridiculous.\nBo: Hm."),
    ["contempt"],
  );
  const firm = scoreLinguistic(
    conv("Ana: I disagree strongly. The evidence points the other way entirely.\nBo: Hm."),
    ["contempt"],
  );
  assert.ok(
    nasty.scores.get("Ana")![0].score! > firm.scores.get("Ana")![0].score!,
    "contempt should separate person attacks from firm disagreement",
  );
});

test("contempt confidence is capped because text hides tone", () => {
  const c = conv("Ana: " + "You are being ridiculous and that is stupid. ".repeat(30) + "\nBo: Hm.");
  const s = scoreLinguistic(c, ["contempt"]).scores.get("Ana")![0];
  assert.ok(s.confidence <= 0.65, `expected cap, got ${s.confidence}`);
});

test("confidence drops for very short contributions", () => {
  const short = scoreLinguistic(conv("Ana: I hear you.\nBo: Hm."), ["receptiveness"]);
  assert.ok(short.scores.get("Ana")![0].confidence <= 0.35);
});

test("densityToScore respects the published thresholds", () => {
  assert.equal(densityToScore("receptiveness", 0), 0);
  assert.equal(densityToScore("receptiveness", 0.5), 1);
  assert.equal(densityToScore("receptiveness", 99), 4);
});

test("scoring is deterministic across runs", () => {
  const text = readFileSync(path.join(fixtures, "housing-workshop.vtt"), "utf8");
  const a = scoreConversation(parseTranscript(text), { arcSegments: 3 });
  const b = scoreConversation(parseTranscript(text), { arcSegments: 3 });
  assert.deepEqual(
    a.speakers.map((s) => s.indicators.map((i) => [i.indicator, i.score, i.confidence])),
    b.speakers.map((s) => s.indicators.map((i) => [i.indicator, i.score, i.confidence])),
  );
});

test("scores the housing fixture with evidence for every non-zero score", () => {
  const score = scoreConversation(parseTranscript(read("housing-workshop.vtt")), {});
  assert.ok(score.speakers.length === 3);
  for (const sp of score.speakers) {
    for (const ind of sp.indicators) {
      if ((ind.score ?? 0) > 0) {
        assert.ok(
          ind.spans.length > 0,
          `${sp.speaker}/${ind.indicator} scored ${ind.score} with no spans`,
        );
        for (const span of ind.spans) assert.equal(span.verified, true);
      }
    }
  }
});

test("arc analysis reports change between first and last segment", () => {
  const score = scoreConversation(parseTranscript(read("housing-workshop.vtt")), {
    arcSegments: 3,
  });
  assert.ok(score.arc);
  assert.equal(score.arc!.segments.length, 3);
  assert.equal(score.arc!.segments[0].label, "Opening third");
  assert.ok(score.arc!.deltas.length > 0);
});

/* --- audio helpers --- */

test("derives speaker names from Zoom-style filenames", () => {
  assert.equal(speakerFromFilename("audio1234567890-Dana Whitfield.m4a"), "Dana Whitfield");
  assert.equal(speakerFromFilename("01_Marcus_Reed.wav"), "Marcus Reed");
  assert.equal(speakerFromFilename("Sam.mp3"), "Sam");
});

test("parses VTT cues back into timed segments", () => {
  const cues = parseVttCues(
    "WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.500\nhello there\n\n2\n00:00:04.000 --> 00:00:05.000\nsecond\n",
  );
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, "hello there");
  assert.ok(Math.abs(cues[0].start - 1) < 0.001);
  assert.ok(Math.abs(cues[1].end - 5) < 0.001);
});

/* --- calibration: the orderings the instrument must produce --- */

test("calibration minimal pairs all order correctly", () => {
  const r = runCalibration(false);
  assert.equal(r.failed, 0, `${r.failed} calibration case(s) failed; run: node dist/calibrate.js`);
  assert.ok(r.passed >= 20, `expected a substantive calibration set, got ${r.passed}`);
});

test("known limitations are tracked and have not grown", () => {
  const r = runCalibration(false);
  // Sarcasm and straight-single-quote attribution cannot be resolved by pattern
  // matching. If this count rises, a lexicon edit introduced a new blind spot.
  assert.ok(
    r.limitationsMissed.length <= 2,
    `open limitations grew to ${r.limitationsMissed.length}: ${r.limitationsMissed.join(", ")}`,
  );
});

test("quoted speech is attributed to whoever was quoted", () => {
  const c = conv('Ana: He said "you\'re right, I was wrong" and sat down.\nBo: Hm.');
  const hits = extractHits(c, ["concession"]);
  assert.equal(hits.length, 0, "markers inside quotation marks should not fire");
});

test("excluding quotations does not swallow contractions", () => {
  const c = conv("Ana: You're right, and I hadn't considered it.\nBo: Hm.");
  const hits = extractHits(c, ["concession"]);
  assert.ok(hits.length > 0, "an apostrophe must not be read as an open quotation");
});

test("short utterances are not inflated by rate normalization", () => {
  const terse = scoreLinguistic(conv("Ana: You're right.\nBo: Hm."), ["concession"]);
  const sustained = scoreLinguistic(
    conv(
      "Ana: You're right about the notification process, and I hadn't considered how that lands. I was wrong to frame it the way I did, and I'm less sure of my position than I was.\nBo: Hm.",
    ),
    ["concession"],
  );
  const t = terse.speakers[0].densities.concession;
  const s = sustained.speakers[0].densities.concession;
  assert.ok(s > t, `sustained concession ${s} should exceed terse ${t}`);
});
