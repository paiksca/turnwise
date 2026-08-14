/**
 * Indicator rubrics.
 *
 * These definitions are the substance of the tool. The scoring model is
 * interchangeable; the construct definitions are not. Each indicator names the
 * observable behavior, the markers that count as evidence for and against it,
 * anchors for every point on the 0-4 scale, and the research the construct
 * comes from.
 *
 * Scoring is per-speaker and evidence-first: a score is only defensible if the
 * quoted spans behind it hold up on inspection. See `docs/METHODOLOGY.md` for
 * what is and is not validated.
 */

export type IndicatorKey =
  | "receptiveness"
  | "perspective_taking"
  | "contempt"
  | "curiosity"
  | "concession"
  | "personal_disclosure";

/** Whether a high score is a good outcome or a bad one. */
export type Valence = "positive" | "negative";

export interface Rubric {
  key: IndicatorKey;
  label: string;
  valence: Valence;
  /** One sentence a program officer can read without training. */
  plain: string;
  /** The precise construct being scored, written for the judge model. */
  definition: string;
  /** Observable behaviors that count as evidence FOR the indicator. */
  positiveMarkers: string[];
  /** Behaviors that look similar but do not count, or count against. */
  negativeMarkers: string[];
  /** Anchors for 0-4. Index = score. */
  anchors: [string, string, string, string, string];
  /** What the score must not be read as claiming. */
  limits: string;
  provenance: string[];
}

export const RUBRICS: Record<IndicatorKey, Rubric> = {
  receptiveness: {
    key: "receptiveness",
    label: "Receptiveness",
    valence: "positive",
    plain:
      "How much this person's language signals genuine willingness to engage with a view they disagree with.",
    definition:
      "Conversational receptiveness is the use of language that communicates willingness to engage thoughtfully with opposing views. It is a property of expression, not of private belief: score what the speaker's words convey to a disagreeing listener, not whether you think they were sincere. Receptiveness is scored only where disagreement is actually present or invited — agreeable conversation with nothing at stake is not high receptiveness, it is out of scope for this indicator (score 0 with a note rather than inflating).",
    positiveMarkers: [
      "Explicit acknowledgment of the other's point before responding ('I hear that you...', 'That's a fair concern')",
      "Hedging and qualification that leaves room for the other position ('it seems to me', 'I could be wrong', 'in some cases')",
      "Agreement stated before disagreement, where the agreement is substantive rather than a throat-clearing 'but'",
      "Restating the other's position in the other's terms before rebutting",
      "Positive or neutral framing of the disagreement ('what we both want is...') rather than framing it as a contest",
      "First-person subjective framing of one's own claims ('I think', 'my read is') rather than asserted fact",
    ],
    negativeMarkers: [
      "'I hear you, but' where the acknowledgment is a formality and no part of the other view is engaged — this is lower, not higher, than a plain disagreement",
      "Hedging used to evade rather than to open ('I guess whatever you think') — disengagement is not receptiveness",
      "Agreement so total that no disagreement exists to be receptive about",
      "Explaining the other's position in order to dismiss it ('you only think that because...')",
      "Negation-heavy framing, absolutes ('never', 'always', 'no one'), and commands",
    ],
    anchors: [
      "No receptive language, or no disagreement present to be receptive about. Assertions delivered without acknowledgment of any other view.",
      "Minimal. One or two hedges or a pro-forma acknowledgment, not connected to the substance of the other position.",
      "Mixed. Some genuine acknowledgment or hedging, but also stretches of flat assertion or dismissal. The receptive moves are present but not characteristic.",
      "Consistent. The speaker regularly acknowledges the other position in its own terms, hedges their own claims, and frames disagreement as shared problem-solving. Occasional lapses.",
      "Sustained and substantive. Nearly every disagreement is prefaced by accurate engagement with the other view. The speaker separates the person from the position and makes their own reasoning inspectable.",
    ],
    limits:
      "Measures expressed receptiveness in language, which is what the other party actually experiences. It does not measure sincerity, private open-mindedness, or whether the speaker later changed their mind.",
    provenance: [
      "Yeomans, Minson, Collins, Chen & Gino (2020), 'Conversational receptiveness: Improving engagement with opposing views', Organizational Behavior and Human Decision Processes — the acknowledgment/hedging/agreement/positive-framing feature set.",
      "Yeomans, Kantor & Tingley (2018), 'The politeness Package: Detecting Politeness in Natural Language', The R Journal — the underlying linguistic markers.",
      "Minson, Chen & Tinsley (2019), 'Why Won't You Listen to Me? Measuring Receptiveness to Opposing Views', Management Science.",
    ],
  },

  perspective_taking: {
    key: "perspective_taking",
    label: "Perspective-taking",
    valence: "positive",
    plain:
      "How much this person actually tries to articulate what the world looks like from the other side.",
    definition:
      "An explicit attempt to represent another person's view, reasons, or experience from the inside. The strong form is perspective-GETTING: asking the other person what their experience is and using their answer, rather than imagining it unaided. Score the attempt to represent, not the accuracy of the representation — but a representation the other party visibly rejects ('no, that's not it at all') caps the score at 2.",
    positiveMarkers: [
      "Articulating the other's reasoning in a form the other would accept ('so if I'm following, the worry is that...')",
      "Naming the value or fear underneath the other's position, not just its surface claim",
      "Asking the other person to describe their own experience and then building on the answer (perspective-getting)",
      "Steel-manning: stating the strongest version of a view the speaker disagrees with",
      "Acknowledging a legitimate reason someone could hold the opposing view",
    ],
    negativeMarkers: [
      "Attributing motives the other person did not state, especially unflattering ones ('you just want...')",
      "Generic empathy language with no content ('I understand where you're coming from') with no attempt to say where that is",
      "Speaking for a group rather than the person present ('people like you think...')",
      "Restating the other's view only as a setup for dismissal",
    ],
    anchors: [
      "No attempt. The other's position appears only as something to argue against, if at all.",
      "Gestural. Empathy phrases with no content, or a single restatement that flattens the other view.",
      "Attempted. At least one real effort to articulate the other's reasoning, possibly inaccurate or partial, or contested by the other party.",
      "Substantive. Multiple accurate articulations of the other's view or values, at least one of which the other party confirms or builds on.",
      "Perspective-getting. The speaker asks about the other's actual experience, listens, and visibly revises their model of the other's position based on the answer.",
    ],
    limits:
      "Measures visible effort to represent another view. It does not measure empathy as an internal state, nor whether the representation was correct beyond what the transcript shows.",
    provenance: [
      "Kalla & Broockman (2020), 'Reducing Exclusionary Attitudes through Interpersonal Conversation', American Political Science Review — non-judgmental exchange of narratives.",
      "Kalla & Broockman (2023), 'Which Narrative Strategies Durably Reduce Prejudice?', American Journal of Political Science.",
      "Eyal, Steffel & Epley (2018), 'Perspective mistaking', JPSP — the perspective-getting vs. perspective-taking distinction and why imagined perspective-taking underperforms.",
    ],
  },

  contempt: {
    key: "contempt",
    label: "Contempt",
    valence: "negative",
    plain:
      "Expressions of superiority or disgust toward the other person — the single most corrosive thing that happens in a hard conversation.",
    definition:
      "Communication that positions the speaker as superior to the other person, or treats the other as an object of disgust or ridicule. Contempt targets the PERSON; ordinary disagreement targets the CLAIM. This distinction is the whole indicator: forceful, even angry disagreement about a position is not contempt. Mockery, name-calling, sarcasm at the other's expense, condescension, and dismissal-as-beneath-response are.",
    positiveMarkers: [
      "Name-calling, labels, or slurs applied to the other person or their group",
      "Mockery or sarcasm directed at the other person, including mimicry of how they talk",
      "Condescension — explaining something as though to a child, or praising the other for meeting a low bar",
      "Claims of superior intelligence, morality, education, or information ('anyone who's actually read the research...')",
      "Dismissal as beneath engagement ('this isn't even worth responding to')",
      "Global character attributions from a single position ('that tells me everything about who you are')",
    ],
    negativeMarkers: [
      "Strong, even heated disagreement about a claim, with the person left intact — not contempt",
      "Expressed anger or hurt about a harm ('that comment hurt me') — not contempt",
      "Criticism of a public figure or institution not present in the conversation — score only if it lands on the person present or their identity",
      "Self-deprecating humor, or humor both parties are visibly in on",
      "Blunt or unpolished phrasing without a superiority claim",
    ],
    anchors: [
      "None. Disagreement, where present, is directed at claims rather than persons.",
      "Trace. One ambiguous moment — an edged joke or a flash of condescension — not repeated and not escalated.",
      "Present. Clear contemptuous moments, but bounded: they occur alongside substantive engagement and do not set the tone.",
      "Characteristic. Contempt recurs across the conversation and shapes how the other party responds.",
      "Pervasive. The dominant register. The other person is treated throughout as an object of ridicule or disgust rather than an interlocutor.",
    ],
    limits:
      "Text-only. Tone of voice, facial expression, and eye-rolling — central to how contempt is normally identified — are invisible here. Expect this score to UNDERCOUNT contempt in a transcript of spoken conversation. Sarcasm in particular is unreliable in text; the confidence value for this indicator will reflect that.",
    provenance: [
      "Gottman & Levenson (1992, 2002) on the Four Horsemen; contempt as the strongest single predictor of relationship dissolution.",
      "Gottman's Specific Affect Coding System (SPAFF), where contempt is coded as superiority-directed affect distinct from anger or criticism.",
      "Note: SPAFF is a multimodal system using video and physiological data. A text-only implementation captures a strict subset.",
    ],
  },

  curiosity: {
    key: "curiosity",
    label: "Curiosity",
    valence: "positive",
    plain:
      "Whether this person actually asks about the other — and especially whether they follow up on the answers.",
    definition:
      "Genuine information-seeking about the other person's views, reasons, or experience. Weight follow-up questions most heavily: a question that builds on the other's immediately preceding answer is the strongest available signal of real attention, and is what listeners themselves perceive as responsiveness. Rhetorical questions, leading questions, and cross-examination are not curiosity.",
    positiveMarkers: [
      "Follow-up questions that reference something the other person just said (highest weight)",
      "Open questions about experience, reasoning, or history ('what led you to that?', 'what was that like?')",
      "Requests for elaboration on a specific point rather than a topic switch",
      "Checking understanding before responding ('do you mean X or Y?')",
      "Asking about the exception or the hard case in the speaker's own position",
    ],
    negativeMarkers: [
      "Rhetorical questions used to assert ('do you really believe that?')",
      "Leading questions engineered to trap ('so you'd agree that...?')",
      "Cross-examination — rapid closed questions building toward a gotcha",
      "Topic-switching questions that abandon what the other just said",
      "Question-shaped statements ('have you considered that you're wrong?')",
    ],
    anchors: [
      "No genuine questions asked.",
      "One or two questions, mostly closed, rhetorical, or topic-switching.",
      "Several real questions, but few build on the answers. Questions and assertions alternate without connecting.",
      "Regular genuine questions including some follow-ups that clearly build on what was just said.",
      "Sustained inquiry. Follow-up questions are the speaker's default mode; they consistently pull on threads the other person opened.",
    ],
    limits:
      "A question count is not attention. This indicator can be gamed by asking many shallow questions; the follow-up weighting mitigates but does not eliminate that.",
    provenance: [
      "Huang, Yeomans, Brooks, Minson & Gino (2017), 'It Doesn't Hurt to Ask: Question-Asking Increases Liking', JPSP — follow-up questions as the strongest liking-relevant question type.",
      "Yeomans, Schweitzer & Brooks (2022), 'The Conversational Circumplex', Current Opinion in Psychology — information exchange as a core conversational dimension.",
    ],
  },

  concession: {
    key: "concession",
    label: "Concession",
    valence: "positive",
    plain:
      "Moments where this person actually granted a point to the other side — the rarest and most meaningful thing in a bridging conversation.",
    definition:
      "An explicit acknowledgment that the other party is right about something, that the speaker's own position has a weakness, or that the speaker's view has moved. This is the rarest indicator and the most important. Because it is rare, score it as a COUNT of distinct concessions with quoted evidence, and be conservative: a false positive here is worse than a miss. Politeness ('good point!') is not a concession unless something is actually granted.",
    positiveMarkers: [
      "Granting a specific claim to the other ('you're right that the data doesn't show that')",
      "Naming a genuine weakness or cost in one's own position, unprompted",
      "Stating a changed or softened view ('I came in thinking X, I'm less sure now')",
      "Accepting a correction of fact without deflecting",
      "Acknowledging that a value the other holds is legitimate even while disagreeing on policy",
    ],
    negativeMarkers: [
      "'Good point, but' where nothing is actually conceded — a transition, not a concession",
      "Conceding something trivial in order to hold the contested ground ('sure, the sky is blue, but...')",
      "Politeness formulas ('fair enough', 'I hear you') with no specific grant",
      "Conceding a point the other party never made",
      "Capitulation under social pressure with no reasoning — record it but note it in the rationale",
    ],
    anchors: [
      "No concessions.",
      "One minor or hedged concession on a peripheral point.",
      "One clear concession on a point that matters, or several minor ones.",
      "Multiple clear concessions on substantive points, including at least one that costs the speaker something in the argument.",
      "Visible movement. The speaker concedes substantively more than once and states a changed or genuinely softened position.",
    ],
    limits:
      "Captures stated concession in the room. It does not measure durable attitude change; that requires follow-up measurement outside this tool. A concession may be strategic or socially compelled.",
    provenance: [
      "Fisher & Ury, 'Getting to Yes' — separating people from problems; interests beneath positions.",
      "Deutsch (1973) on constructive vs. destructive conflict processes.",
      "Treated here as a behavioral proxy for the in-conversation moments that attitude-change measures pick up later.",
    ],
  },

  personal_disclosure: {
    key: "personal_disclosure",
    label: "Personal disclosure",
    valence: "positive",
    plain:
      "Whether this person spoke from their own life rather than only in arguments and abstractions.",
    definition:
      "Sharing specific personal experience, history, or emotion as part of engaging the topic. This is the active ingredient identified in deep canvassing: exchange of non-judgmental personal narrative, not exchange of arguments. Score specificity and relevance — a concrete story from the speaker's own life connected to the topic scores high; abstract self-reference ('as a parent, I think policy X') scores low.",
    positiveMarkers: [
      "A specific incident from the speaker's own life, with concrete detail",
      "Naming an emotion the speaker actually felt, tied to an experience",
      "Describing how the speaker came to hold a view, including the path or turning point",
      "Sharing a relevant vulnerability, uncertainty, or an experience of being wrong",
      "Reciprocating a disclosure the other party made",
    ],
    negativeMarkers: [
      "Identity claims used as argumentative credentials ('as a veteran, I can tell you...') with no experience shared",
      "Generic category statements ('people in my situation feel...') without a personal instance",
      "Second-hand stories about other people, unless the speaker's own stake is clear",
      "Disclosure that functions as a bid for deference rather than connection",
      "Off-topic personal content with no bearing on the discussion",
    ],
    anchors: [
      "None. The speaker engages only in abstractions, arguments, or third-party facts.",
      "Nominal. Identity claims or category statements with no actual experience shared.",
      "Some. At least one genuine personal experience, briefly stated or thinly connected to the topic.",
      "Substantive. Multiple specific personal experiences clearly connected to the topic, including some emotional content.",
      "Central. Personal narrative is how this speaker engages. Concrete, specific, emotionally honest, and directly relevant — including reciprocation of the other's disclosures.",
    ],
    limits:
      "Volume of disclosure is not intimacy or trust, and disclosure can be strategic. High disclosure in an unsafe setting may indicate poor facilitation rather than good dialogue.",
    provenance: [
      "Broockman & Kalla (2016), 'Durably reducing transphobia', Science — the deep-canvassing result.",
      "Kalla & Broockman (2023), AJPS — narrative exchange outperforming argument exchange.",
      "Collins & Miller (1994) meta-analysis on self-disclosure and liking.",
    ],
  },
};

export const INDICATOR_KEYS = Object.keys(RUBRICS) as IndicatorKey[];

/** Compact form injected into the judge prompt. */
export function rubricForPrompt(r: Rubric): string {
  return [
    `### ${r.label} (key: ${r.key}, valence: ${r.valence})`,
    ``,
    r.definition,
    ``,
    `Counts as evidence FOR:`,
    ...r.positiveMarkers.map((m) => `- ${m}`),
    ``,
    `Does NOT count, or counts against:`,
    ...r.negativeMarkers.map((m) => `- ${m}`),
    ``,
    `Scale anchors:`,
    ...r.anchors.map((a, i) => `- ${i}: ${a}`),
  ].join("\n");
}

export function allRubricsForPrompt(keys: IndicatorKey[] = INDICATOR_KEYS): string {
  return keys.map((k) => rubricForPrompt(RUBRICS[k])).join("\n\n");
}
