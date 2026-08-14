/**
 * End-to-end smoke test over the real MCP protocol.
 *
 * Spawns the server over stdio exactly as Claude Desktop would, then exercises
 * every tool, resource, and prompt. Nothing here needs an API key or network
 * access, so this exercises the real thing end to end.
 *
 * Run: node dist/smoke.js
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(here, "index.js");
const fixtures = path.resolve(here, "..", "fixtures");

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function textOf(res: any): string {
  return (res.content ?? []).map((c: any) => c.text ?? "").join("\n");
}

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env } as Record<string, string>,
  });
  const client = new Client({ name: "smoke", version: "1.0.0" });
  await client.connect(transport);

  console.log("\nhandshake");
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  check("server advertises the full toolset", names.length === 9, `got ${names.join(", ")}`);
  for (const expected of [
    "parse_transcript",
    "transcribe_audio",
    "transcribe_session",
    "check_audio_support",
    "score_conversation",
    "extract_evidence",
    "compare_conversations",
    "analyze_cohort",
    "explain_indicator",
  ]) {
    check(`tool present: ${expected}`, names.includes(expected));
  }

  const resources = await client.listResources();
  check(
    "resources advertised",
    resources.resources.length === 2,
    resources.resources.map((r) => r.uri).join(", "),
  );

  const prompts = await client.listPrompts();
  check("prompts advertised", prompts.prompts.length === 2);

  console.log("\nparse_transcript (VTT, no API key needed)");
  const vtt = await client.callTool({
    name: "parse_transcript",
    arguments: { transcript_path: path.join(fixtures, "housing-workshop.vtt") },
  });
  const vttText = textOf(vtt);
  check("detects vtt", vttText.includes("**vtt**"));
  check("finds all three speakers", ["Dana", "Marcus", "Facilitator"].every((s) => vttText.includes(s)));
  check("reports airtime", vttText.includes("Airtime Gini"));
  check("no unknown speakers", !vttText.includes("| Unknown |"));

  console.log("\nparse_transcript (plain text + aliasing)");
  const plain = await client.callTool({
    name: "parse_transcript",
    arguments: {
      transcript_path: path.join(fixtures, "contentious-thread.txt"),
      speaker_aliases: { Riley: "Participant A", Sam: "Participant B" },
    },
  });
  const plainText = textOf(plain);
  check("aliases applied", plainText.includes("Participant A") && !plainText.includes("| Riley |"));

  console.log("\nexplain_indicator");
  const explain = await client.callTool({
    name: "explain_indicator",
    arguments: { indicator: "contempt" },
  });
  const explainText = textOf(explain);
  check("returns rubric prose", explainText.includes("# Contempt"));
  check("states the direction", explainText.includes("lower is better"));
  check("states the limits", explainText.includes("does not tell you"));
  check("cites provenance", explainText.includes("Gottman"));

  console.log("\nresources");
  const rubrics = await client.readResource({ uri: "bridgescore://rubrics" });
  const parsed = JSON.parse((rubrics.contents[0] as any).text);
  check("rubric resource parses as JSON", typeof parsed.version === "string");
  check("carries all six indicators", Object.keys(parsed.indicators).length === 6);

  const method = await client.readResource({ uri: "bridgescore://methodology" });
  const methodText = (method.contents[0] as any).text as string;
  check("methodology states validation status", methodText.includes("Not validated instrument scores"));

  console.log("\nanalyze_cohort (deterministic, no API key)");
  const fakeScores = [0, 1].map((i) => ({
    conversationId: `conv_${i}`,
    model: "test",
    scoredAt: new Date().toISOString(),
    rubricVersion: "1.0.0",
    structure: {
      turnCount: 4,
      wordCount: 40,
      speakerCount: 2,
      perSpeaker: [],
      airtimeGini: 0.1,
      questionRate: 0.25,
    },
    speakers: [
      {
        speaker: "A",
        turnCount: 2,
        wordCount: 20,
        indicators: [
          {
            indicator: "receptiveness",
            label: "Receptiveness",
            valence: "positive",
            score: i === 0 ? 1 : 3,
            confidence: 0.8,
            rationale: "test",
            spans: [],
          },
        ],
      },
      {
        speaker: "B",
        turnCount: 2,
        wordCount: 20,
        indicators: [
          {
            indicator: "receptiveness",
            label: "Receptiveness",
            valence: "positive",
            score: i === 0 ? 2 : 4,
            confidence: 0.7,
            rationale: "test",
            spans: [],
          },
        ],
      },
    ],
    conversationMeans: [],
    warnings: [],
    meta: { cohort: i === 0 ? "before" : "after" },
  }));

  const cohort = await client.callTool({
    name: "analyze_cohort",
    arguments: { scores: fakeScores, group_by: "cohort", indicators: ["receptiveness"] },
  });
  const cohortText = textOf(cohort);
  check("aggregates speaker observations", cohortText.includes("4 speaker observations"));
  check("compares the two groups", cohortText.includes("after compared with before"));
  check("reports an effect size", cohortText.includes("Cohen's d"));
  check("keeps the causal caveat", cohortText.includes("not a causal estimate"));

  console.log("\nerror handling");
  const missing = await client.callTool({ name: "parse_transcript", arguments: {} });
  check("missing transcript is a clean error", (missing as any).isError === true);
  check(
    "error message is actionable",
    textOf(missing).includes("transcript_path"),
    textOf(missing),
  );

  console.log("\nscore_conversation (deterministic, no key)");
  const scored = await client.callTool({
    name: "score_conversation",
    arguments: {
      transcript_path: path.join(fixtures, "housing-workshop.vtt"),
      arc_segments: 3,
    },
  });
  const scoredText = textOf(scored);
  check("returns a report", scoredText.includes("# Dialogue score"));
  check("scores every speaker", ["## Dana", "## Marcus"].every((s) => scoredText.includes(s)));
  check("attaches evidence quotes", scoredText.includes("> [turn "));
  check("includes the arc", scoredText.includes("Change across the conversation"));
  check("points at validation status", scoredText.includes("METHODOLOGY.md"));
  check("names the engine that produced the scores", scoredText.includes("linguistic-deterministic"));
  check("emits structured data", scoredText.includes("<structured_data>"));

  console.log("\ndeterminism across separate server calls");
  const again = await client.callTool({
    name: "score_conversation",
    arguments: {
      transcript_path: path.join(fixtures, "housing-workshop.vtt"),
      arc_segments: 3,
    },
  });
  // The run timestamp appears in both the JSON and the report footer.
  const strip = (t: string) => t.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "<ts>");
  check("identical output on a second call", strip(scoredText) === strip(textOf(again)));

  console.log("\nextract_evidence");
  const evidence = await client.callTool({
    name: "extract_evidence",
    arguments: { transcript_path: path.join(fixtures, "contentious-thread.txt") },
  });
  const evText = textOf(evidence);
  check("lists candidates to adjudicate", evText.includes("Candidates to confirm or reject"));
  check("surfaces unmatched turns", evText.includes("Turns with no pattern match"));
  check("flags sarcasm risk", evText.toLowerCase().includes("sarcastic"));
  // Direction must be carried on every candidate. Whether this particular
  // transcript contains a counter-marker is a property of the fixture, so
  // assert the field rather than requiring a hit.
  const evJson = JSON.parse(evText.split("<structured_data>")[1].split("</structured_data>")[0]);
  check(
    "every candidate carries a direction",
    evJson.candidates.length > 0 &&
      evJson.candidates.every(
        (c: any) => c.direction === "supports" || c.direction === "counts_against",
      ),
  );
  check("candidates carry the rule that fired", evJson.candidates.every((c: any) => c.rule));

  console.log("\ncheck_audio_support");
  const audio = await client.callTool({ name: "check_audio_support", arguments: {} });
  const audioText = textOf(audio);
  check("reports backend status", audioText.includes("Local transcription support"));
  check(
    "gives install guidance when nothing is present",
    audioText.includes("Transcription is available") || audioText.includes("pip install"),
  );

  console.log("\naudio error path");
  const badAudio = await client.callTool({
    name: "transcribe_audio",
    arguments: { file_path: "/nonexistent/recording.m4a" },
  });
  check("missing audio fails cleanly", (badAudio as any).isError === true);

  console.log("\n--- report excerpt ---");
  console.log(scoredText.split("<structured_data>")[0].slice(0, 2600));

  await client.close();

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke test crashed:", err);
  process.exit(1);
});
