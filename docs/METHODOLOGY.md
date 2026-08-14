# Methodology and validation status

Read this before putting turnwise numbers in a report.

## How scoring works

1. Parse. The transcript becomes speaker turns, and consecutive segments from one speaker merge into a single turn, because caption formats split an utterance across many cue blocks.
2. Match. Each turn goes through the lexicon in `src/lexicon.ts`, where every pattern carries a weight, and the scanner skips anything inside quotation marks, since quoted words belong to whoever said them.
3. Suppress. Where a negative marker overlaps a positive one, the negative wins. This is what puts "you're right, but" below a plain disagreement.
4. Normalize. Weighted hits become a rate per 100 words, with the denominator floored at 75, because without that floor a six-word reply containing one strong marker outscores fifty words of sustained work. The short reply is no more receptive; there is less text to divide by.
5. Damp. Counter-markers can subtract at most 60% of what the positive evidence earned, so one absolute remark does not erase the work.
6. Map. The rate crosses `THRESHOLDS` in `src/linguistic.ts` to land on 0-4.

Two signals are computed from turn structure: a follow-up question is one that reuses content words from the previous speaker's turn, which is the observable trace of having listened, and reciprocated disclosure is disclosure that lands within two turns of someone else's.

The output is identical on every run, because the whole pipeline is arithmetic over pattern matches.

## Confidence

Confidence combines how much text the score rests on with how many markers fired, since forty words give a thin signal however many markers hit. Contempt is capped at 0.65 regardless, and below 0.5 you should read the evidence before using the number.

## Limits

Validation against trained human coders is still outstanding, so treat these as structured, evidence-linked observations.

Pattern matching only sees words, and the documented failures live in `fixtures/calibration.json`:

| Case | Status |
| --- | --- |
| Negated markers ("I would never say you're right") | Handled |
| Reported contempt ("he called the room stupid") | Handled |
| Quoted speech, double or curly quotes | Handled |
| Quoted speech, straight single quotes | Open. Indistinguishable from apostrophes. |
| Sarcastic agreement | Open. Tone is invisible in text. |

Those two open cases are why `extract_evidence` exists.

Contempt runs low, since tone and facial expression carry most of it and a transcript has neither. Transcription errors propagate, so check `parse_transcript` output before scoring. Curiosity is gameable through many shallow questions, which follow-up weighting reduces without eliminating, and the thresholds are fitted to fixtures and remain provisional.

A score describes expressed behavior in one conversation, so it says nothing about what a participant believes. Participants choose which workshop to attend, so a difference between two groups may come from who signed up rather than from anything the program did.

## Using this in a funder report

Report the evidence next to the number and keep the caveats, because the strongest available claim is behavioral and specific: "across 14 workshops and 212 participants, concession appeared in 68% of closing thirds against 31% of opening thirds, and here are the moments." Avoid "our program increased receptiveness by 40%."

## What would make these validated

1. A hand-coded reference set from trained coders on real bridging transcripts.
2. Inter-rater reliability between coders, then between coders and this tool, per indicator.
3. Thresholds re-fit against that set.
4. Calibration against self-report instruments on the same sessions.
5. Test-retest across transcription backends, to quantify how much ASR error moves a score.

Steps 1 and 2 are the fellowship work.

## Versioning

`RUBRIC_VERSION` in `src/score.ts` identifies the instrument, and any edit to the lexicon or thresholds requires a bump, which is why `analyze_cohort` warns when it receives scores spanning versions.
