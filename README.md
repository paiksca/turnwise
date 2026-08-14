# turnwise

An MCP server that scores dialogue transcripts for bridging quality.

Pre/post surveys ask participants how they felt. turnwise reads what they said, and gives each speaker six scores.

```
### Concession: 4.00, confidence 0.75

Three markers across 175 words, granting a point to the other side twice and
stating a changed view once, for a weighted density of 2.40 per 100 words.

> [turn 11] **Sam:** "Although you got me on the transportation contract."
> [turn 11] **Sam:** "But I'm less comfortable than I was ten minutes ago."
```

`extract_evidence` returns the pattern matches with the rule that fired and the turns where nothing matched, leaving you to decide whether a match means what the rule assumes.

## Install

```bash
npm install && npm run build
```

Add this to `claude_desktop_config.json`, then restart Claude Desktop:

```json
{
  "mcpServers": {
    "turnwise": {
      "command": "node",
      "args": ["/absolute/path/to/turnwise/dist/index.js"]
    }
  }
}
```

## Tools

| Tool | Purpose |
| --- | --- |
| `score_conversation` | Per-speaker scores with evidence. `arc_segments: 3` shows change across a session. |
| `extract_evidence` | Matches for you to adjudicate, plus unmatched turns. |
| `parse_transcript` | Check speaker detection before scoring. |
| `compare_conversations` | Two sessions side by side. |
| `analyze_cohort` | Aggregate many conversations, with effect sizes. |
| `explain_indicator` | Full rubric, limits, and citations for one indicator. |
| `transcribe_audio` | Local speech-to-text for one recording. |
| `transcribe_session` | Multitrack folder to one speaker-labeled transcript. |
| `check_audio_support` | Which local backends are installed. |

The parser detects WebVTT, SRT, Otter, Rev, plain `Speaker: text`, and JSON.

## Indicators

| Indicator | Direction | Grounded in |
| --- | --- | --- |
| Receptiveness | higher is better | Yeomans, Minson, Collins, Chen & Gino (2020) |
| Perspective-taking | higher is better | Kalla & Broockman (2020, 2023) |
| Contempt | lower is better | Gottman & Levenson (1992, 2002) |
| Curiosity | higher is better | Huang, Yeomans, Brooks, Minson & Gino (2017) |
| Concession | higher is better | Deutsch (1973); Fisher & Ury |
| Personal disclosure | higher is better | Broockman & Kalla (2016) |

Follow-up questions and reciprocated disclosure are computed from turn structure, and `explain_indicator` covers the rest.

## Audio

```bash
pip install mlx-whisper        # Apple Silicon, fastest
pip install -U openai-whisper  # cross-platform
brew install whisper-cpp       # no Python
brew install ffmpeg            # video and multitrack
```

`transcribe_audio` returns text without speaker labels, because this tool does no diarization.

Changing one recording setting fixes this: in Zoom, turn on Settings > Recording > Record a separate audio file for each participant, then point `transcribe_session` at the folder. Each file holds one person, so attribution is exact and the filenames become the speaker names.

## Limits

Read [docs/METHODOLOGY.md](docs/METHODOLOGY.md) before putting these numbers in a report.

Validation against trained human coders is still outstanding, so treat these as evidence-linked observations. Contempt comes in low because tone carries most of it and a transcript has none, and sarcastic agreement will score as ordinary agreement. Participants choose which workshop to attend, so a difference between two groups may come from who signed up rather than from anything the program did.

## Development

```bash
npm test          # 32 unit tests
npm run calibrate # 22 minimal pairs the instrument must order correctly
npm run smoke     # exercises every tool over MCP
```

Run `calibrate` after any lexicon edit, since it also tracks the adversarial cases that pattern matching cannot solve.

Editing `src/lexicon.ts` changes the instrument, so bump `RUBRIC_VERSION` when you do, or year-over-year comparisons stop meaning anything.

Apache-2.0.
