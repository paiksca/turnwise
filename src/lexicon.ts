/**
 * Marker lexicon.
 *
 * These patterns are the measurement instrument. They run locally, produce the
 * same output on the same input forever, and every hit is an exact character
 * offset in the source text, so evidence is verified by construction rather
 * than checked after the fact.
 *
 * The feature families follow the published work: the acknowledgment / hedging /
 * agreement / positive-framing set from the conversational receptiveness
 * literature, and the superiority-and-mockery set from Gottman's contempt
 * coding. Where the literature specifies a feature family but not a word list,
 * the list here is our own and is marked as such.
 *
 * Every pattern carries a weight. Positive weights push a score up, negative
 * weights pull it down, which is how "I hear you, but" ends up scoring below a
 * plain disagreement.
 *
 * Editing this file changes the instrument. Bump RUBRIC_VERSION when you do,
 * or year-over-year comparisons silently stop meaning anything.
 */

import type { IndicatorKey } from "./rubrics.js";

export interface Marker {
  /** Stable id, used in evidence output so a hit can be traced to a rule. */
  id: string;
  /** Case-insensitive pattern. Must use \b boundaries to avoid substring hits. */
  pattern: RegExp;
  /** Positive counts toward the indicator, negative counts against. */
  weight: number;
  /** Shown to users to explain why this matched. */
  note: string;
}

export interface MarkerFamily {
  indicator: IndicatorKey;
  markers: Marker[];
}

/** Build a case-insensitive global pattern from alternatives, with word boundaries. */
function alt(...phrases: string[]): RegExp {
  const escaped = phrases.map((p) =>
    p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"),
  );
  return new RegExp(`\\b(?:${escaped.join("|")})\\b`, "gi");
}

/* ------------------------------------------------------------------ */
/* Receptiveness                                                       */
/* ------------------------------------------------------------------ */

const RECEPTIVENESS: Marker[] = [
  {
    id: "recept.acknowledgment",
    pattern: alt(
      "i understand",
      "i hear you",
      "i hear that",
      "i see what you",
      "i can see why",
      "that makes sense",
      "i get that",
      "i get what you",
      "i appreciate that",
      "that's fair",
      "that is fair",
      "fair enough",
      "fair point",
      "good point",
      "i take your point",
    ),
    weight: 1.0,
    note: "Acknowledges the other position before responding",
  },
  {
    id: "recept.hedge",
    pattern: alt(
      "maybe",
      "perhaps",
      "possibly",
      "probably",
      "might be",
      "could be",
      "it seems",
      "seems like",
      "i think",
      "i guess",
      "i suppose",
      "i'd say",
      "sort of",
      "kind of",
      "a bit",
      "somewhat",
      "in some cases",
      "not always",
      "i could be wrong",
      "i may be wrong",
      "i'm not sure",
      "i don't know if",
    ),
    weight: 0.6,
    note: "Hedged claim leaves room for the other position",
  },
  {
    id: "recept.agreement",
    pattern: alt(
      "i agree",
      "you're right",
      "you are right",
      "that's true",
      "that is true",
      "exactly",
      "i'm with you",
      "same here",
      "no argument",
    ),
    weight: 0.9,
    note: "Explicit agreement",
  },
  {
    id: "recept.subjectivity",
    pattern: alt(
      "in my view",
      "my sense is",
      "my read is",
      "the way i see it",
      "for me",
      "personally",
      "i believe",
      "i feel like",
    ),
    weight: 0.5,
    note: "Frames own claim as a view rather than a fact",
  },
  {
    id: "recept.restatement",
    pattern: alt(
      "so you're saying",
      "so what you're saying",
      "if i'm following",
      "if i understand",
      "let me make sure i",
      "it sounds like you",
      "what i hear you saying",
    ),
    weight: 1.2,
    note: "Restates the other position before responding",
  },
  {
    id: "recept.absolutes",
    // Deliberately narrow. Bare "always" and "never" are usually descriptive
    // ("it's always our street"), and counting those as closed-mindedness
    // punishes people for describing the pattern that frustrates them. Only
    // absolutes aimed at the other party or at their claim count.
    pattern: alt(
      "you always",
      "you never",
      "you people always",
      "everyone knows",
      "no one thinks",
      "nobody thinks",
      "nobody believes",
      "completely wrong",
      "totally wrong",
      "flat out wrong",
      "absolutely not",
      "there's no way",
      "there is no way",
      "end of story",
      "period",
    ),
    weight: -0.5,
    note: "Absolute framing aimed at the other position leaves no room to engage",
  },
  {
    id: "recept.hollow_pivot",
    // "I hear you, but" and "fair point, but": acknowledgment immediately negated.
    pattern:
      /\b(?:i hear (?:you|that)|i understand|fair enough|fair point|good point|that's fair|you're right)\b[^.!?]{0,30}?,?\s*(?:but|however|although|still)\b/gi,
    weight: -0.7,
    note: "Acknowledgment immediately cancelled, so it does not function as engagement",
  },
];

/* ------------------------------------------------------------------ */
/* Perspective-taking                                                  */
/* ------------------------------------------------------------------ */

const PERSPECTIVE_TAKING: Marker[] = [
  {
    id: "persp.other_state",
    // "you want" alone matches ordinary logistics ("do you want to go first?"),
    // so the generic verbs need an object that makes them about the person's
    // stance rather than their preference in the moment.
    pattern: alt(
      "you feel",
      "you felt",
      "you must feel",
      "you probably feel",
      "you think",
      "you thought",
      "you believe",
      "you're worried",
      "you are worried",
      "you were worried",
      "you care about",
      "you want to protect",
      "what you want is",
      "matters to you",
      "important to you",
      "scares you",
      "worries you",
    ),
    weight: 0.8,
    note: "Attributes a view or concern to the other person",
  },
  {
    id: "persp.your_position",
    pattern: alt(
      "your view",
      "your position",
      "your perspective",
      "your point",
      "your concern",
      "your side",
      "your experience",
      "from your perspective",
      "where you're coming from",
      "in your shoes",
      "in your position",
    ),
    weight: 1.0,
    note: "References the other's position as a position worth naming",
  },
  {
    id: "persp.restate",
    pattern: alt(
      "so you're saying",
      "if i understand you",
      "if i'm following",
      "it sounds like you",
      "what i hear you saying",
      "correct me if i'm wrong",
      "am i right that you",
    ),
    weight: 1.4,
    note: "Articulates the other's reasoning in a checkable form",
  },
  {
    id: "persp.legitimize",
    pattern: alt(
      "i can see why",
      "i can understand why",
      "it makes sense that you",
      "reasonable to",
      "that's a fair question",
      "that is a fair question",
      "i don't have a good answer",
    ),
    weight: 1.0,
    note: "Grants that the other view has a legitimate basis",
  },
  {
    id: "persp.motive_attribution",
    pattern: alt(
      "you just want",
      "you only care",
      "you people",
      "your kind",
      "people like you",
      "you don't actually",
      "admit it",
    ),
    weight: -1.2,
    note: "Assigns motives the other person did not state",
  },
];

/* ------------------------------------------------------------------ */
/* Contempt                                                            */
/* ------------------------------------------------------------------ */

const CONTEMPT: Marker[] = [
  {
    id: "contempt.superiority",
    pattern: alt(
      "anyone who",
      "any reasonable person",
      "obviously",
      "clearly you",
      "you clearly",
      "as i already said",
      "as i said",
      "like i said",
      "let me explain",
      "i'll explain it",
      "do your research",
      "educate yourself",
      "read a book",
      "actually read",
      "if you knew anything",
      "you'd know",
      "everybody knows",
      "basic logic",
      "common sense",
    ),
    weight: 1.2,
    note: "Positions the speaker above the other person",
  },
  {
    id: "contempt.mockery",
    pattern: alt(
      "congratulations",
      "oh please",
      "give me a break",
      "spare me",
      "how convenient",
      "sure you did",
      "good for you",
      "cute",
      "adorable",
      "genius",
      "brilliant",
    ),
    weight: 1.1,
    note: "Sarcasm or mockery aimed at the person",
  },
  {
    id: "contempt.dismissal",
    pattern: alt(
      "whatever",
      "not worth",
      "waste of time",
      "waste of breath",
      "typical",
      "of course you",
      "why do i bother",
      "this is pointless",
      "i'm done",
      "moving on",
    ),
    weight: 0.9,
    note: "Dismisses the other as beneath engagement",
  },
  {
    id: "contempt.labeling",
    pattern: alt(
      "idiot",
      "idiotic",
      "stupid",
      "moron",
      "clueless",
      "delusional",
      "brainwashed",
      "sheep",
      "insane",
      "ridiculous",
      "absurd",
      "pathetic",
      "disgusting",
    ),
    weight: 1.4,
    note: "Labels applied to the person or their view",
  },
  {
    id: "contempt.person_attack",
    // "you are/you're + judgment" targets the person rather than the claim.
    pattern:
      /\byou(?:'re| are)\s+(?:being\s+)?(?:so\s+|such\s+a\s+|just\s+)?(?:wrong|ridiculous|absurd|dishonest|naive|ignorant|delusional|impossible|insufferable)\b/gi,
    weight: 1.3,
    note: "Judgment aimed at the person rather than the claim",
  },
];

/* ------------------------------------------------------------------ */
/* Curiosity                                                           */
/* ------------------------------------------------------------------ */

const CURIOSITY: Marker[] = [
  {
    id: "curiosity.open_stem",
    pattern: alt(
      "what was that like",
      "what led you",
      "what makes you",
      "how did you",
      "how do you",
      "why do you",
      "what do you think",
      "tell me more",
      "say more about",
      "can you say more",
      "help me understand",
      "what's that like",
      "what would it take",
    ),
    weight: 1.2,
    note: "Open question inviting the other to expand",
  },
  {
    id: "curiosity.clarify",
    pattern: alt(
      "do you mean",
      "what do you mean",
      "are you saying",
      "did i get that right",
      "is that right",
      "can you clarify",
    ),
    weight: 0.9,
    note: "Checks understanding before responding",
  },
  {
    id: "curiosity.leading",
    pattern: alt(
      "do you really",
      "do you honestly",
      "so you'd agree",
      "wouldn't you agree",
      "don't you think",
      "how can you",
      "how could you",
      "are you seriously",
    ),
    weight: -1.0,
    note: "Question shaped as an assertion or a trap",
  },
];

/* ------------------------------------------------------------------ */
/* Concession                                                          */
/* ------------------------------------------------------------------ */

const CONCESSION: Marker[] = [
  {
    id: "concession.grant",
    pattern: alt(
      "you're right",
      "you are right",
      "you've got a point",
      "you have a point",
      "point taken",
      "i'll grant",
      "i'll give you that",
      "i concede",
      "i stand corrected",
      "i was wrong",
      "i got that wrong",
      "my mistake",
      "that's true",
      "that is true",
      "that's a fair question",
    ),
    weight: 1.4,
    note: "Grants a point to the other side",
  },
  {
    id: "concession.update",
    pattern: alt(
      "i've changed my mind",
      "i changed my mind",
      "i hadn't considered",
      "i hadn't thought",
      "i didn't know that",
      "i'm less sure",
      "less comfortable than i was",
      "that's different from how",
      "i've been treating",
      "i hadn't looked at it",
      "you got me",
      "i'd forgotten",
    ),
    weight: 1.6,
    note: "States a changed or softened view",
  },
  {
    id: "concession.self_limit",
    pattern: alt(
      "i don't have a good answer",
      "i genuinely don't know",
      "i don't know",
      "that's not right",
      "and it's not right",
      "i'm not going to defend",
      "that part i agree",
      "the outreach was bad",
    ),
    weight: 1.0,
    note: "Names a weakness or limit in the speaker's own position",
  },
  {
    id: "concession.hollow",
    pattern:
      /\b(?:you're right|that's true|fair point|good point|point taken)\b[^.!?]{0,25}?,?\s*(?:but|however|still|although)\b/gi,
    weight: -0.8,
    note: "Concession immediately withdrawn, so nothing was actually granted",
  },
];

/* ------------------------------------------------------------------ */
/* Personal disclosure                                                 */
/* ------------------------------------------------------------------ */

const PERSONAL_DISCLOSURE: Marker[] = [
  {
    id: "disclosure.narrative",
    pattern: alt(
      "when i was",
      "i remember",
      "i grew up",
      "years ago",
      "i used to",
      "i once",
      "happened to me",
      "in my experience",
      "i've lived",
      "i have lived",
      "i've been",
      "i was looking",
      "i've looked",
    ),
    weight: 1.1,
    note: "Recounts personal experience",
  },
  {
    id: "disclosure.relations",
    pattern: alt(
      "my son",
      "my daughter",
      "my kid",
      "my kids",
      "my child",
      "my children",
      "my mother",
      "my mom",
      "my father",
      "my dad",
      "my wife",
      "my husband",
      "my partner",
      "my sister",
      "my brother",
      "my family",
      "my neighbor",
      "my friend",
      "my grandmother",
      "my grandfather",
    ),
    weight: 1.0,
    note: "Brings a specific person from the speaker's life into the conversation",
  },
  {
    id: "disclosure.emotion",
    pattern: alt(
      "i was angry",
      "i felt",
      "i was scared",
      "i was afraid",
      "i was hurt",
      "it hurt",
      "i was upset",
      "i worry",
      "i'm worried",
      "i was worried",
      "i'm afraid",
      "that gets me",
      "i can't get past",
      "honestly",
      "to be honest",
      "i want to be honest",
    ),
    weight: 0.9,
    note: "Names an emotion the speaker felt",
  },
  {
    id: "disclosure.credential_only",
    // Identity used as argumentative standing rather than shared experience.
    pattern:
      /\bas an?\s+(?:veteran|parent|mother|father|teacher|nurse|doctor|lawyer|christian|muslim|jew|conservative|liberal|democrat|republican|immigrant|business owner)\b/gi,
    weight: -0.4,
    note: "Identity claimed as credentials without an experience shared",
  },
];

export const FAMILIES: MarkerFamily[] = [
  { indicator: "receptiveness", markers: RECEPTIVENESS },
  { indicator: "perspective_taking", markers: PERSPECTIVE_TAKING },
  { indicator: "contempt", markers: CONTEMPT },
  { indicator: "curiosity", markers: CURIOSITY },
  { indicator: "concession", markers: CONCESSION },
  { indicator: "personal_disclosure", markers: PERSONAL_DISCLOSURE },
];

export const MARKERS_BY_INDICATOR: Record<IndicatorKey, Marker[]> = Object.fromEntries(
  FAMILIES.map((f) => [f.indicator, f.markers]),
) as Record<IndicatorKey, Marker[]>;

/** Function words excluded from the follow-up-question overlap test. */
export const STOPWORDS = new Set(
  `a about above after again against all am an and any are aren't as at be because been before being
   below between both but by can cannot could couldn't did didn't do does doesn't doing don't down during
   each few for from further had hadn't has hasn't have haven't having he her here hers herself him himself
   his how i i'd i'll i'm i've if in into is isn't it it's its itself just me more most my myself no nor not
   of off on once only or other ought our ours ourselves out over own same shan't she should shouldn't so
   some such than that that's the their theirs them themselves then there these they this those through to
   too under until up very was wasn't we were weren't what when where which while who whom why with won't
   would wouldn't you you'd you'll you're you've your yours yourself yourselves yeah okay ok well like just
   really think know going get got say said thing things lot`
    .split(/\s+/)
    .filter(Boolean),
);
