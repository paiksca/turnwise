/**
 * Cross-conversation aggregation.
 *
 * A single conversation's score is close to meaningless to a funder. The unit
 * of value is the comparison: this cohort against that one, this workshop
 * format against the previous, first third against last. Everything here is
 * deterministic arithmetic over scores produced earlier.
 *
 * The unit of observation is the SPEAKER. Treating a six-person workshop as one
 * data point throws away most of the information and understates variance.
 */

import { cohensD, mean, median, round, sd } from "./metrics.js";
import { INDICATOR_KEYS, RUBRICS, type IndicatorKey } from "./rubrics.js";
import type { CohortReport, ConversationScore } from "./types.js";

export interface CohortOptions {
  /** Meta key to group by, e.g. "cohort" or "site" or "format". */
  groupBy?: string;
  indicators?: IndicatorKey[];
}

export function buildCohortReport(
  scores: ConversationScore[],
  opts: CohortOptions = {},
): CohortReport {
  const indicators = opts.indicators?.length ? opts.indicators : INDICATOR_KEYS;
  const caveats: string[] = [];

  if (scores.length === 0) {
    throw new Error("No conversation scores supplied.");
  }

  const versions = new Set(scores.map((s) => s.rubricVersion));
  if (versions.size > 1) {
    caveats.push(
      `Scores span rubric versions ${[...versions].join(", ")}. Numbers from different rubric versions are not directly comparable.`,
    );
  }
  const engines = new Set(scores.map((s) => s.model));
  if (engines.size > 1) {
    caveats.push(
      `Scores came from more than one engine (${[...engines].join(", ")}). Some of the spread between conversations reflects that difference.`,
    );
  }

  const observations = scores.flatMap((conv) =>
    conv.speakers.map((sp) => ({
      conversationId: conv.conversationId,
      speaker: sp.speaker,
      group: opts.groupBy ? (conv.meta?.[opts.groupBy] ?? "ungrouped") : undefined,
      byIndicator: new Map(
        sp.indicators.map((i) => [i.indicator, { score: i.score, confidence: i.confidence }]),
      ),
    })),
  );

  if (observations.length < 10) {
    caveats.push(
      `Only ${observations.length} speaker observations. Report these as descriptive counts, not as estimates of an effect.`,
    );
  }

  const indicatorRows = indicators.map((key) => {
    const values = observations
      .map((o) => o.byIndicator.get(key)?.score)
      .filter((v): v is number => v !== null && v !== undefined);
    const confs = observations
      .map((o) => o.byIndicator.get(key)?.confidence)
      .filter((v): v is number => v !== undefined);
    return {
      indicator: key,
      label: RUBRICS[key].label,
      valence: RUBRICS[key].valence,
      n: values.length,
      mean: mean(values),
      sd: sd(values),
      median: median(values),
      meanConfidence: round(mean(confs) ?? 0, 2),
    };
  });

  const lowConfidence = indicatorRows.filter((r) => r.meanConfidence < 0.5);
  if (lowConfidence.length > 0) {
    caveats.push(
      `Mean confidence is below 0.5 for: ${lowConfidence.map((r) => r.label).join(", ")}. Read the evidence spans for these before reporting the numbers.`,
    );
  }

  let groups: CohortReport["groups"];
  let comparison: CohortReport["comparison"];

  if (opts.groupBy) {
    const names = [...new Set(observations.map((o) => o.group ?? "ungrouped"))].sort();
    groups = names.map((name) => {
      const inGroup = observations.filter((o) => (o.group ?? "ungrouped") === name);
      return {
        group: name,
        n: inGroup.length,
        indicators: indicators.map((key) => {
          const values = inGroup
            .map((o) => o.byIndicator.get(key)?.score)
            .filter((v): v is number => v !== null && v !== undefined);
          return { indicator: key, mean: mean(values), sd: sd(values) };
        }),
      };
    });

    if (names.length === 2) {
      const [a, b] = names;
      const valuesFor = (group: string, key: IndicatorKey) =>
        observations
          .filter((o) => (o.group ?? "ungrouped") === group)
          .map((o) => o.byIndicator.get(key)?.score)
          .filter((v): v is number => v !== null && v !== undefined);

      comparison = indicators.map((key) => {
        const va = valuesFor(a, key);
        const vb = valuesFor(b, key);
        const ma = mean(va);
        const mb = mean(vb);
        return {
          indicator: key,
          label: RUBRICS[key].label,
          groupA: a,
          groupB: b,
          meanA: ma,
          meanB: mb,
          difference: ma !== null && mb !== null ? round(ma - mb, 3) : null,
          cohensD: cohensD(va, vb),
        };
      });

      caveats.push(
        "Participants choose which workshop to attend, so a difference between these groups may come from who signed up rather than from anything the program did.",
      );
    } else if (names.length > 2) {
      caveats.push(
        `Grouped by "${opts.groupBy}" into ${names.length} groups. Pairwise effect sizes are reported only when there are exactly two groups.`,
      );
    }
  }

  return {
    conversationCount: scores.length,
    speakerObservations: observations.length,
    generatedAt: new Date().toISOString(),
    rubricVersion: [...versions].join(", "),
    indicators: indicatorRows,
    groups,
    comparison,
    caveats,
  };
}
