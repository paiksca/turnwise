# bridgescore

An MCP server that scores dialogue transcripts for bridging quality and shows the words behind every number.

Bridging organizations record their workshops, then struggle to tell a funder what changed in the room. Pre/post surveys capture how participants felt and skip the conversation itself. bridgescore reads the transcript and gives each speaker six scores.

```
### Concession: 4.00 · 3 instances · confidence 0.75

3 markers across 175 words: grants a point to the other side (2); states a
changed view (1). Weighted density 2.40 per 100 words maps to 4.

> [turn 11] **Sam:** "Although you got me on the transportation contract."
> [turn 11] **Sam:** "But I'm less comfortable than I was ten minutes ago."
```

Scoring is pattern matching against a published lexicon. It needs no API key and no network, so recordings never leave the machine. The same transcript always yields the same numbers, so a 2027 report compares against 2026. Model-judged scores drift whenever the model updates.

An LLM is already calling this server, so the server measures and the caller interprets. `extract_evidence` returns every match for you to confirm or reject, plus the turns where nothing matched.

## Install

```bash
npm install && npm run build
```

Add this to `claude_desktop_config.json`, then restart Claude Desktop:

```json
{
  "mcpServers": {
    "bridgescore": {
      "command": "node",
      "args": ["/absolute/path/to/bridgescore/dist/index.js"]
    }
  }
}
```

## Tools

| Tool | Purpose |
| --- | --- |
| `score_conversation` | Per-speaker scores with evidence. `arc_segments: 3` shows change across a session. |
| `extract_evidence` | Every match for you to adjudicate, plus unmatched turns. |
| `parse_transcript` | Check speaker detection before scoring. |
| `compare_conversations` | Two sessions side by side. |
| `analyze_cohort` | Aggregate many conversations, with effect sizes. |
| `explain_indicator` | Full rubric, limits, and citations for one indicator. |
| `transcribe_audio` | Local speech-to-text for one recording. |
| `transcribe_session` | Multitrack folder to one speaker-labeled transcript. |
| `check_audio_support` | Which local backends are installed. |

The parser detects WebVTT, SRT, Otter, Rev, plain `Speaker: text`, and JSON without being told which one it has.

## Indicators

| Indicator | Direction | Grounded in |
| --- | --- | --- |
| Receptiveness | higher is better | Yeomans, Minson, Collins, Chen & Gino (2020) |
| Perspective-taking | higher is better | Kalla & Broockman (2020, 2023) |
| Contempt | lower is better | Gottman & Levenson (1992, 2002) |
| Curiosity | higher is better | Huang, Yeomans, Brooks, Minson & Gino (2017) |
| Concession | higher is better | Deutsch (1973); Fisher & Ury |
| Personal disclosure | higher is better | Broockman & Kalla (2016) |

Follow-up questions and reciprocated disclosure are computed from turn structure. Call `explain_indicator` for anything else.

## Audio

```bash
pip install mlx-whisper        # Apple Silicon, fastest
pip install -U openai-whisper  # cross-platform
brew install whisper-cpp       # no Python
brew install ffmpeg            # video and multitrack
```

Nothing reliably splits a mixed recording by speaker, so `transcribe_audio` returns the text without speaker labels and says so. Guessed speakers produce confidently wrong per-speaker scores.

Changing one recording setting fixes this. In Zoom, turn on Settings > Recording > Record a separate audio file for each participant. Point `transcribe_session` at the folder; each file holds one person, so attribution is exact and filenames become speaker names.

## Limits

Read [docs/METHODOLOGY.md](docs/METHODOLOGY.md) before putting these numbers in a report.

These are not validated instrument scores, since no inter-rater reliability against trained coders exists yet. Contempt comes in low because tone carries most of it and a transcript has none, and sarcastic agreement will score as ordinary agreement. Nobody assigns participants to workshops at random, so a difference between groups describes those groups and nothing more.

## Development

```bash
npm test          # 32 unit tests
npm run calibrate # 22 minimal pairs the instrument must order correctly
npm run smoke     # exercises every tool over MCP
```

Run `calibrate` after any lexicon edit. It also tracks the adversarial cases pattern matching cannot solve, so the blind spots stay visible.

Editing `src/lexicon.ts` changes the instrument. Bump `RUBRIC_VERSION` when you do, or year-over-year comparisons quietly stop meaning anything.

Apache-2.0.
