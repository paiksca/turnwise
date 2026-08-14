# Changelog

Two version numbers matter here, and they move independently.

`version` in `package.json` tracks the software. `RUBRIC_VERSION` in `src/score.ts` tracks the instrument: the marker lexicon in `src/lexicon.ts` and the thresholds in `src/linguistic.ts`. Scores produced under different rubric versions are not comparable, and `analyze_cohort` warns when it receives a mix. Record the rubric version alongside any number you report.

## 0.2.0

Rubric 1.0.0.

Scoring became deterministic and local. Earlier work called a model to judge each transcript, which meant scores changed when the model changed and participant text left the machine. Scoring is now pattern matching against the published lexicon, so a transcript yields the same numbers on every run, and everything stays on the machine that runs it.

The calling model does the interpretation. `extract_evidence` returns every pattern match with the rule that fired, plus the turns where nothing matched, for the caller to confirm or reject.

Added local audio transcription. `transcribe_session` merges a folder of per-participant recordings into one speaker-labeled transcript, which gives exact attribution because each file holds one person.

Added the calibration suite: 22 minimal pairs asserting the orderings the constructs claim, plus four adversarial cases tracking what pattern matching cannot resolve. Two of those remain open, sarcastic agreement and quoted speech in straight single quotes.

## Rubric 1.0.0

First published instrument. Six indicators: receptiveness, perspective-taking, contempt, curiosity, concession, and personal disclosure.

Thresholds are fitted to the fixture set and remain provisional, and validation against trained human coders is still outstanding, as `docs/METHODOLOGY.md` sets out.

### Changing the rubric

Any edit to `src/lexicon.ts` or `THRESHOLDS` changes what the numbers mean. Bump `RUBRIC_VERSION`, run `npm run calibrate`, and note here what moved and why. A lexicon change that fixes one case and breaks three others is the normal failure mode, which is what the calibration suite exists to catch.
