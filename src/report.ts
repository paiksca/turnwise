/**
 * Markdown rendering.
 *
 * The realistic reader is a program manager at a small nonprofit reading inside
 * Claude Desktop. Structured data still comes back
 * on every call, but the readable version is what most people will use, so it
 * leads with the finding and puts the evidence next to the number that rests on it.
 */

import { RUBRICS } from "./rubrics.js";
import type { CohortReport, ConversationScore, IndicatorScore, Span } from "./types.js";

export function renderConversationReport(score: ConversationScore): string {
  const out: string[] = [];
  const s = score.structure;

  out.push(`# Dialogue score: ${score.conversationId}`);
  out.push("");
  if (score.meta && Object.keys(score.meta).length) {
    out.push(
      Object.entries(score.meta)
        .map(([k, v]) => `**${k}:** ${v}`)
        .join(" · "),
    );
    out.push("");
  }

  out.push(
    `${s.turnCount} turns · ${s.wordCount.toLocaleString()} words · ${s.speakerCount} speakers` +
      (s.durationSec ? ` · ${Math.round(s.durationSec / 60)} min` : ""),
  );
  out.push("");

  if (score.warnings.length) {
    out.push("## Read these first");
    out.push("");
    for (const w of score.warnings) out.push(`- ${w}`);
    out.push("");
  }

  out.push("## Conversation summary");
  out.push("");
  out.push("| Indicator | Mean (0-4) | Direction | Confidence |");
  out.push("| --- | --- | --- | --- |");
  for (const m of score.conversationMeans) {
    const arrow = m.valence === "positive" ? "higher is better" : "lower is better";
    out.push(
      `| ${m.label} | ${fmt(m.mean)} | ${arrow} | ${m.confidence.toFixed(2)} |`,
    );
  }
  out.push("");

  out.push("## Who did the work");
  out.push("");
  out.push("| Speaker | Turns | Words | Airtime | Questions asked |");
  out.push("| --- | --- | --- | --- | --- |");
  for (const p of s.perSpeaker) {
    out.push(
      `| ${p.speaker} | ${p.turns} | ${p.words} | ${(p.airtimeShare * 100).toFixed(0)}% | ${p.questionTurns} |`,
    );
  }
  out.push("");
  out.push(
    `Airtime Gini: ${s.airtimeGini.toFixed(2)} (0 means everyone spoke equally, 1 means one person held the floor). ${giniNote(s.airtimeGini, s.speakerCount)}`,
  );
  out.push("");

  for (const sp of score.speakers) {
    out.push(`## ${sp.speaker}`);
    out.push("");
    out.push(`${sp.turnCount} turns, ${sp.wordCount} words.`);
    out.push("");
    for (const ind of sp.indicators) {
      out.push(renderIndicator(ind));
    }
  }

  if (score.arc) {
    out.push("## Change across the conversation");
    out.push("");
    out.push("| Indicator | " + score.arc.segments.map((g) => g.label).join(" | ") + " | Change |");
    out.push("| --- |" + score.arc.segments.map(() => " --- |").join("") + " --- |");
    for (const d of score.arc.deltas) {
      const cells = score.arc.segments.map((g) =>
        fmt(g.indicators.find((i) => i.indicator === d.indicator)?.score ?? null),
      );
      const marker =
        d.favorable === null ? "" : d.favorable ? " (favorable)" : " (unfavorable)";
      out.push(`| ${d.label} | ${cells.join(" | ")} | ${fmtDelta(d.delta)}${marker} |`);
    }
    out.push("");
    out.push(
      "Segments are equal slices of the turn list, so they track conversational progress and not elapsed time. A change between segments describes this one conversation and is by itself no evidence that the program caused it.",
    );
    out.push("");
  }

  out.push("---");
  out.push("");
  out.push(
    `Scored by ${score.model}, rubric v${score.rubricVersion}, at ${score.scoredAt}. These are pattern-based observations against a published rubric. Validation status and known limits are in METHODOLOGY.md; read it before putting these numbers in a funder report.`,
  );

  return out.join("\n");
}

function renderIndicator(ind: IndicatorScore): string {
  const lines: string[] = [];
  const countPart = ind.count !== undefined ? ` · ${ind.count} instance${ind.count === 1 ? "" : "s"}` : "";
  lines.push(
    `### ${ind.label}: ${fmt(ind.score)}${countPart} · confidence ${ind.confidence.toFixed(2)}`,
  );
  lines.push("");
  lines.push(ind.rationale);
  lines.push("");

  const verified = ind.spans.filter((s) => s.verified);
  const failed = ind.spans.filter((s) => !s.verified);

  if (verified.length) {
    lines.push("Evidence:");
    lines.push("");
    for (const span of verified) lines.push(renderSpan(span));
    lines.push("");
  } else if (ind.score !== null && ind.score > 0) {
    lines.push("_No evidence quote could be verified against the transcript._");
    lines.push("");
  }

  if (failed.length) {
    lines.push(
      `_${failed.length} quote${failed.length === 1 ? "" : "s"} could not be found in the transcript and ${failed.length === 1 ? "was" : "were"} discarded: ${failed.map((f) => `"${truncate(f.quote, 60)}"`).join(", ")}._`,
    );
    lines.push("");
  }

  return lines.join("\n");
}

function renderSpan(span: Span): string {
  return `> [turn ${span.turnIndex}] **${span.speaker}:** "${span.quote}"`;
}

export function renderCohortReport(report: CohortReport): string {
  const out: string[] = [];

  out.push(`# Cohort report`);
  out.push("");
  out.push(
    `${report.conversationCount} conversations · ${report.speakerObservations} speaker observations · rubric v${report.rubricVersion}`,
  );
  out.push("");

  out.push("## Across all conversations");
  out.push("");
  out.push("| Indicator | n | Mean | SD | Median | Confidence |");
  out.push("| --- | --- | --- | --- | --- | --- |");
  for (const r of report.indicators) {
    out.push(
      `| ${r.label} | ${r.n} | ${fmt(r.mean)} | ${fmt(r.sd)} | ${fmt(r.median)} | ${r.meanConfidence.toFixed(2)} |`,
    );
  }
  out.push("");

  if (report.groups?.length) {
    out.push("## By group");
    out.push("");
    const keys = report.indicators.map((i) => i.indicator);
    out.push("| Group | n | " + report.indicators.map((i) => i.label).join(" | ") + " |");
    out.push("| --- | --- |" + keys.map(() => " --- |").join(""));
    for (const g of report.groups) {
      const cells = keys.map((k) => fmt(g.indicators.find((i) => i.indicator === k)?.mean ?? null));
      out.push(`| ${g.group} | ${g.n} | ${cells.join(" | ")} |`);
    }
    out.push("");
  }

  if (report.comparison?.length) {
    const [first] = report.comparison;
    out.push(`## ${first.groupA} compared with ${first.groupB}`);
    out.push("");
    out.push(`| Indicator | ${first.groupA} | ${first.groupB} | Difference | Cohen's d |`);
    out.push("| --- | --- | --- | --- | --- |");
    for (const c of report.comparison) {
      out.push(
        `| ${c.label} | ${fmt(c.meanA)} | ${fmt(c.meanB)} | ${fmtDelta(c.difference)} | ${fmt(c.cohensD)} |`,
      );
    }
    out.push("");
  }

  if (report.caveats.length) {
    out.push("## Caveats");
    out.push("");
    for (const c of report.caveats) out.push(`- ${c}`);
    out.push("");
  }

  return out.join("\n");
}

export function renderIndicatorExplainer(key: keyof typeof RUBRICS): string {
  const r = RUBRICS[key];
  return [
    `# ${r.label}`,
    "",
    r.plain,
    "",
    `Direction: ${r.valence === "positive" ? "higher is better" : "lower is better"}.`,
    "",
    "## What is being scored",
    "",
    r.definition,
    "",
    "## Counts as evidence",
    "",
    ...r.positiveMarkers.map((m) => `- ${m}`),
    "",
    "## Does not count",
    "",
    ...r.negativeMarkers.map((m) => `- ${m}`),
    "",
    "## Scale",
    "",
    ...r.anchors.map((a, i) => `**${i}.** ${a}`),
    "",
    "## What this score does not tell you",
    "",
    r.limits,
    "",
    "## Where the construct comes from",
    "",
    ...r.provenance.map((p) => `- ${p}`),
  ].join("\n");
}

function fmt(n: number | null | undefined): string {
  return n === null || n === undefined ? "n/a" : n.toFixed(2);
}

function fmtDelta(n: number | null): string {
  if (n === null) return "n/a";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}`;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}...`;
}

function giniNote(g: number, speakers: number): string {
  if (speakers < 2) return "";
  if (g < 0.2) return "Airtime was close to even.";
  if (g < 0.4) return "Airtime was somewhat uneven.";
  return "Airtime was heavily concentrated; worth checking against the facilitator's read of the session.";
}
