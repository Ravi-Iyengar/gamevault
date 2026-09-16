import { QuarterMoment } from "./TimeGalleryService";

/**
 * Generates the per-card flavor text for the Time Gallery. Deliberately
 * local/template-based, not LLM-generated (confirmed preference) — a
 * large template pool per tone, with deterministic-but-varied selection
 * so the same card always shows the same line on repeat views (stable,
 * not re-randomized every render) while different cards for the same
 * game draw from different parts of the pool.
 *
 * This version (Time Gallery variety/UI pass, project handoff Section
 * 9.2) is a substantial expansion over the original:
 *  - ~2-3x more lines per tone, plus three new tones (roguelike,
 *    multiplayer, puzzle) detected from GameModes/Keywords data that
 *    only exists in the schema since the GLIP unification.
 *  - Keyword-driven flavor fragments ({keywordnod}) so two games in the
 *    same tone bucket (e.g. two "serious" RPGs) can still read as
 *    genuinely different from each other, not just from a different
 *    random template.
 *  - Franchise-specific bonus lines for the games already mapped in
 *    FRANCHISE_FLAVOR, woven into the same selection pool.
 *  - The actual root cause of the "kept you waiting, huh?" overuse
 *    complaint: that line was a GENERIC long-gap template any game could
 *    draw, with a Metal-Gear-specific joke embedded in it. It's now in
 *    a Metal-Gear-only pool and can never surface for anything else.
 *
 * Genuinely can't be as nuanced as hand-written or LLM-written text for
 * every one of hundreds of games — a rule table can't capture something
 * like "Persona 5 is serious but also playful" the way a human or a
 * model could. What it can do is vary tone by genre/theme/mode/keyword,
 * throw in light franchise-aware and general-gaming-culture references,
 * and avoid feeling like the exact same sentence over and over.
 */

export type Tone =
  | "serious"
  | "playful"
  | "sporty"
  | "tense"
  | "tactical"
  | "cozy"
  | "adventurous"
  | "roguelike"
  | "multiplayer"
  | "puzzle";

const SEASON_BY_QUARTER: Record<1 | 2 | 3 | 4, string> = {
  // Northern Hemisphere mapping — an assumption, not detected from the
  // user's actual location, since that's a bigger separate question.
  1: "winter",
  2: "spring",
  3: "summer",
  4: "autumn",
};

export function classifyTone(
  genres: string[],
  themes: string[],
  title: string,
  keywords: string[] = [],
  gameModes: string[] = []
): Tone {
  const g = genres.map((x) => x.toLowerCase());
  const t = themes.map((x) => x.toLowerCase());
  const k = keywords.map((x) => x.toLowerCase());
  const m = gameModes.map((x) => x.toLowerCase());
  const titleLower = title.toLowerCase();

  if (g.some((x) => x.includes("sport") || x.includes("racing"))) return "sporty";
  if (t.some((x) => x.includes("horror") || x.includes("survival") || x.includes("thriller"))) return "tense";
  if (
    g.some((x) => x.includes("shooter") || x.includes("fighting") || x.includes("moba") || x.includes("tactical")) ||
    t.some((x) => x.includes("warfare"))
  )
    return "tactical";
  if (k.some((x) => x.includes("roguelike") || x.includes("roguelite") || x.includes("permadeath"))) return "roguelike";
  if (
    m.some(
      (x) =>
        x.includes("multiplayer") ||
        x.includes("co-operative") ||
        x.includes("cooperative") ||
        x.includes("massively multiplayer") ||
        x.includes("battle royale")
    )
  )
    return "multiplayer";
  if (g.some((x) => x.includes("puzzle"))) return "puzzle";
  if (t.some((x) => x.includes("comedy") || x.includes("party") || x.includes("kids"))) return "playful";
  if (t.some((x) => x.includes("sandbox")) || g.some((x) => x.includes("simulator"))) return "cozy";
  if (
    t.some((x) => x.includes("drama") || x.includes("historical")) ||
    g.some((x) => x.includes("role-playing") || x.includes("adventure") || x.includes("strategy"))
  )
    return "serious";
  if (/mario|kirby|animal crossing|stardew/i.test(titleLower)) return "playful";
  return "adventurous";
}

function sportFlavor(title: string): string {
  const t = title.toLowerCase();
  if (/fifa|\bfc \d|football manager/i.test(t)) return "the pitch";
  if (/nba|2k\d/i.test(t)) return "the court";
  if (/madden|nfl/i.test(t)) return "the gridiron";
  if (/nhl/i.test(t)) return "the ice";
  if (/mlb/i.test(t)) return "the diamond";
  if (/f1|forza|gran turismo|need for speed/i.test(t)) return "the track";
  return "the field";
}

// Keyword-driven micro-flavor: a short phrase reflecting something
// genuinely specific about the game, independent of its tone bucket.
// Two "serious" RPGs can both be true, but if one is tagged
// "open world" and the other "turn-based", these give each card a
// slightly different sentence rather than an identical template.
// Order matters — first match wins, roughly most-distinctive first.
const KEYWORD_NODS: Array<{ pattern: RegExp; phrase: string }> = [
  { pattern: /metroidvania/, phrase: "backtracking for that one item you needed three areas ago" },
  { pattern: /soulslike|souls-like/, phrase: "dying in the same spot with something to prove" },
  { pattern: /open world/, phrase: "on a map that wasn't going anywhere" },
  { pattern: /visual novel/, phrase: "reading between the choices" },
  { pattern: /deck.?build|card game|card battler/, phrase: "shuffling toward a better hand" },
  { pattern: /city.?build|management|tycoon|colony sim/, phrase: "running spreadsheets dressed up as a game" },
  { pattern: /crafting/, phrase: "with the crafting menu open more than the map" },
  { pattern: /turn-based/, phrase: "taking exactly as long as you needed to" },
  { pattern: /stealth/, phrase: "staying exactly one shadow ahead of trouble" },
  { pattern: /procedural(ly)? generat/, phrase: "somewhere the map hadn't drawn before" },
  { pattern: /point.and.click/, phrase: "clicking on everything twice, just in case" },
  { pattern: /survival/, phrase: "keeping one eye on the meter that mattered most" },
  { pattern: /puzzle/, phrase: "staring at the same room a little too long" },
  { pattern: /rhythm/, phrase: "chasing the beat, not the story" },
  { pattern: /battle royale/, phrase: "landing hot and hoping for the best" },
  { pattern: /sandbox/, phrase: "making your own reasons to keep going" },
  { pattern: /time travel/, phrase: "somewhere it definitely wasn't the right decade" },
  { pattern: /base.?build/, phrase: "with a build you kept meaning to finish" },
];

function keywordNod(keywords: string[], collections: string[]): string | null {
  const haystack = [...keywords, ...collections].join(" | ").toLowerCase();
  for (const { pattern, phrase } of KEYWORD_NODS) {
    if (pattern.test(haystack)) return phrase;
  }
  return null;
}

const FRANCHISE_FLAVOR: Record<string, string> = {
  warframe: "Tenno",
  "dark souls": "Undead",
  "elden ring": "Tarnished",
  bloodborne: "hunter",
  persona: "Phantom Thief",
  "final fantasy": "warrior of light",
  "the legend of zelda": "hero of Hyrule",
  zelda: "hero of Hyrule",
  "elder scrolls": "Dragonborn",
  fallout: "Vault dweller",
  "mass effect": "Commander",
  destiny: "Guardian",
  overwatch: "hero",
  "world of warcraft": "adventurer",
  "monster hunter": "hunter",
  minecraft: "builder",
  "animal crossing": "villager",
  "metal gear": "operative",
};

/** Returns the matched FRANCHISE_FLAVOR key (e.g. "metal gear"), not the
 * nod word itself — shared by franchiseNod() and the franchise-specific
 * template lookups below so all three stay in sync off one match. */
function matchFranchiseKey(franchise: string | null, title: string): string | null {
  const key = (franchise ?? title).toLowerCase();
  for (const name of Object.keys(FRANCHISE_FLAVOR)) {
    if (key.includes(name)) return name;
  }
  return null;
}

function franchiseNod(franchiseKey: string | null): string | null {
  if (!franchiseKey) return null;
  return FRANCHISE_FLAVOR[franchiseKey] ?? null;
}

interface TemplateContext {
  title: string;
  franchiseOrTitle: string;
  season: string;
  year: number;
  hours: number;
  sessions: number;
  platform: string | null;
  nod: string | null;
  sportPlace: string;
  keywordNod: string | null;
}

function fill(template: string, ctx: TemplateContext): string {
  const filled = template
    .replace(/\{title\}/g, ctx.title)
    .replace(/\{franchise\}/g, ctx.franchiseOrTitle)
    .replace(/\{season\}/g, ctx.season)
    .replace(/\{year\}/g, String(ctx.year))
    .replace(/\{hours\}/g, ctx.hours.toFixed(ctx.hours < 10 ? 1 : 0))
    .replace(/\{sessions\}/g, String(ctx.sessions))
    .replace(/\{plural\}/g, ctx.sessions === 1 ? "" : "s")
    .replace(/\{platform\}/g, ctx.platform ?? "your setup")
    .replace(/\{nod\}/g, ctx.nod ?? "player")
    .replace(/\{sportplace\}/g, ctx.sportPlace)
    .replace(/\{keywordnod\}/g, ctx.keywordNod ?? "whatever kept pulling you back");

  // Cheap catch-all for the singular/plural mismatch this produces
  // whenever a template hardcodes "sessions"/"matches" after {sessions}
  // and the real count happens to be 1 — fixing this in every template
  // by hand wasn't worth the effort across a pool this size, but
  // "1 sessions" reads badly enough to be worth a blanket regex pass.
  if (ctx.sessions === 1) {
    return filled.replace(/\b1 sessions\b/g, "1 session").replace(/\b1 matches\b/g, "1 match");
  }
  return filled;
}

const TEMPLATES: Record<Tone, string[]> = {
  serious: [
    "This {season}, {title} demanded your full attention — {hours}h of it, across {sessions} sessions.",
    "You gave {title} {hours}h this {season}, the kind of commitment a story like this asks for.",
    "{season} {year}: {title} took you somewhere heavy, {hours}h at a time.",
    "No half-measures with {title} this {season} — {sessions} sessions, {hours}h logged.",
    "The {nod} in you showed up for {title} this {season}, {hours}h deep.",
    "{title} isn't a game you rush. This {season} you gave it {hours}h and meant it.",
    "This {season}, you carried {title}'s weight for {hours}h — worth every one of them.",
    "{sessions} sessions with {title} this {season}. Some stories earn that kind of time.",
    "{title} asked a lot of you this {season}. You answered with {hours}h.",
    "A {season} spent with {title} — {hours}h of the kind of focus this game deserves.",
    "This {season}, {title} was {hours}h of {keywordnod} — and you didn't look away.",
    "{title} doesn't hand you anything easily. This {season}, {hours}h proved you weren't asking it to.",
    "{sessions} sessions in, {title} still had your full attention this {season}.",
    "This {season}'s {title} time ({hours}h) was spent {keywordnod}.",
    "You sat with {title} this {season} — {hours}h of a story that wasn't going to tell itself faster.",
    "{title}: {hours}h this {season}, and every one of them earned.",
  ],
  playful: [
    "This {season}, {title} was pure joy — {hours}h of it, and clearly you were having fun.",
    "{sessions} sessions of {title} this {season}. Somebody was having a good time.",
    "{title} kept things light this {season} — {hours}h well spent smiling.",
    "This {season}, you let loose with {title} for {hours}h. No notes, just fun.",
    "{title}: {hours}h of {season} joy, no explanation needed.",
    "You and {title} this {season} — {sessions} sessions of exactly the fun it promised.",
    "{season} {year} called for something fun, and {title} delivered — {hours}h of it.",
    "{title} doesn't take itself too seriously, and this {season}, neither did you — {hours}h in.",
    "Some {season}s just need {title}. This one got {hours}h of it.",
    "{sessions} playful sessions with {title} this {season} — exactly the vibe.",
    "This {season}, {title} meant {hours}h of {keywordnod}, no complaints from you.",
    "{title} this {season}: {hours}h of the good kind of nonsense.",
    "You didn't need a reason for {title} this {season} — {hours}h of fun is reason enough.",
    "{sessions} sessions that didn't ask much of you except to enjoy {title}. Mission accomplished.",
  ],
  sporty: [
    "This {season}, you were on {sportplace} with {title} — {hours}h chasing the win.",
    "{sessions} sessions on {sportplace} this {season}, courtesy of {title}.",
    "{title} had you on {sportplace} for {hours}h this {season}. Personal best or bust.",
    "This {season}'s season on {sportplace}: {title}, {hours}h, {sessions} matches worth of it.",
    "You put in {hours}h on {sportplace} this {season} with {title} — training never stops.",
    "{title} this {season}: {sessions} sessions on {sportplace}, chasing that one more win.",
    "This {season} you lived on {sportplace} — {title}, {hours}h, all business.",
    "{hours}h on {sportplace} this {season}, {title} keeping score the whole time.",
    "This {season}'s stat line: {title}, {sessions} sessions, {hours}h on {sportplace}.",
    "{title} didn't let up on {sportplace} this {season} — {hours}h of proving it.",
  ],
  tense: [
    "This {season}, {title} kept you on edge for {hours}h — {sessions} sessions of it.",
    "{title} this {season}: {hours}h you spent more alert than comfortable.",
    "Nerves of steel required — {hours}h with {title} this {season}.",
    "This {season} you went back into {title} anyway. {hours}h braver for it.",
    "{sessions} sessions of {title} this {season}, and your heart rate has the receipts.",
    "{title} doesn't let you relax. This {season}, {hours}h of it and you're still here.",
    "This {season}'s {title} run: {hours}h of tension you clearly wanted more of.",
    "This {season}, {title} meant {hours}h of {keywordnod} and not much breathing room.",
    "{title} this {season}: {sessions} sessions, and you checked every corner anyway.",
    "{hours}h of {title} this {season} — the good kind of dread.",
  ],
  tactical: [
    "This {season}, {title} put you to work — {hours}h across {sessions} sessions, calling the shots.",
    "{title} this {season}: {hours}h of reading the room, calling plays, adapting on the fly.",
    "You ran the numbers on {title} this {season} — {sessions} sessions, {hours}h, no wasted moves.",
    "This {season} you were the one holding the line in {title} — {hours}h of it.",
    "{sessions} sessions of {title} this {season}. Positioning, timing, execution — all present.",
    "{title} rewards the ones paying attention. This {season}, that was you — {hours}h in.",
    "This {season}'s {title} sessions ({hours}h) were about outthinking, not outgunning — mostly.",
    "{title} this {season}: {hours}h of {keywordnod}, every one of them earned.",
    "This {season}, {sessions} sessions of {title} went about as clean as {hours}h allows.",
  ],
  cozy: [
    "This {season}, {title} was your quiet place — {hours}h of it, unhurried.",
    "{sessions} low-key sessions with {title} this {season}. No rush, no pressure.",
    "{title} this {season}: {hours}h of the kind of calm that's hard to find elsewhere.",
    "You let {title} slow you down this {season} — {hours}h well spent doing not much at all.",
    "This {season} belonged a little to {title} — {hours}h of easy, unbothered time.",
    "{title}: {hours}h of {season} spent exactly how you wanted to spend it.",
    "This {season}'s {title} time ({hours}h) asked nothing of you but showing up.",
    "This {season}, {title} meant {hours}h of {keywordnod} — no complaints.",
    "{sessions} sessions of {title} this {season}, all of them unhurried.",
    "{title} this {season}: {hours}h spent {keywordnod}, and that was the whole point.",
  ],
  adventurous: [
    "This {season}, {title} took you somewhere new — {hours}h of it, {sessions} sessions deep.",
    "{sessions} sessions with {title} this {season}. Wherever it went, you followed.",
    "{title} this {season}: {hours}h of finding out what was over the next hill.",
    "This {season} you wandered through {title} for {hours}h, in no particular hurry to leave.",
    "{title}: {hours}h of {season} spent somewhere you hadn't been before.",
    "This {season}'s {title} run covered a lot of ground — {hours}h of it.",
    "You gave {title} {hours}h this {season}, and it gave you somewhere to be for a while.",
    "This {season}, {title} meant {hours}h of {keywordnod}.",
    "{sessions} sessions of {title} this {season} — you kept finding reasons to stay.",
    "{title} this {season}: {hours}h, and still more map than you'd covered.",
  ],
  roguelike: [
    "This {season}, {title} meant {hours}h of runs that mostly didn't end well — and one more go anyway.",
    "{sessions} runs of {title} this {season}. The good one's still coming.",
    "{title} this {season}: {hours}h of starting over and getting a little further each time.",
    "This {season}, you died in {title} more than you'd like to admit — {hours}h of trying again.",
    "{sessions} attempts, {hours}h, and {title} still hasn't seen the last of you this {season}.",
    "This {season}'s {title} runs ({hours}h) were less about winning than getting good.",
    "{title} this {season}: every run different, {hours}h of finding that out the hard way.",
    "This {season}, {hours}h of {title} taught you exactly where you keep dying — progress, sort of.",
    "{sessions} runs of {title} this {season}. One of them almost counted.",
  ],
  multiplayer: [
    "This {season}, {title} meant {hours}h with other people in the loop — {sessions} sessions of it.",
    "{sessions} sessions of {title} this {season}, and you weren't the only one on the server.",
    "{title} this {season}: {hours}h of showing up when the squad did too.",
    "This {season}, {title} was a group effort — {hours}h, {sessions} sessions, somebody else's fault half the time.",
    "{hours}h of {title} this {season}, and at least one of those wins wasn't entirely solo.",
    "This {season}'s {title} sessions ({hours}h) had other people to answer to.",
    "{title} this {season}: {sessions} sessions where the plan survived contact with teammates. Mostly.",
    "This {season}, {hours}h of {title} — better with company, worse when they disconnect.",
  ],
  puzzle: [
    "This {season}, {title} had you staring at the same screen a little too long — {hours}h of it.",
    "{sessions} sessions of {title} this {season}, most of them one \"aha\" away from quitting.",
    "{title} this {season}: {hours}h of turning the same problem over until it gave in.",
    "This {season} you and {title} had a staring contest — {hours}h, and you didn't blink first.",
    "{hours}h of {title} this {season}, {sessions} sessions of quietly refusing to look up the answer.",
    "This {season}'s {title} time ({hours}h) was slower than it sounds, and that was the appeal.",
    "{title} this {season}: {sessions} sessions of almost giving up, right before you didn't.",
  ],
};

const LONG_GAP_TEMPLATES: string[] = [
  "You finally got around to finishing {title} — {longgap} quarters after you started. Worth the wait.",
  "{title}: started {longgap} quarters ago, finished this {season}. The backlog boss has fallen.",
  "{longgap} quarters between hello and goodbye with {title} — but you closed the loop this {season}.",
  "You circled back to {title} after {longgap} quarters away and actually saw it through this time.",
  "That's a {longgap}-quarter respawn timer on {title}, but this {season} you finally cleared it.",
  "{title} sat mid-run for {longgap} quarters. This {season}, you picked the controller back up and finished it.",
  "Somewhere in the backlog, {title} was waiting {longgap} quarters for this exact {season}.",
  "The behemoth that was {title} took {longgap} quarters, but this {season} it went down.",
  "{longgap} quarters is a long respawn for {title} — but this {season}, you finally hit the credits.",
  "It took {longgap} quarters, but this {season} {title} finally got the ending it was owed.",
  "{title} went quiet for {longgap} quarters and came back this {season} to actually finish the job.",
  "{longgap} quarters is a lot of patience for {title} — but this {season}, it paid off.",
];

// Franchise-specific long-gap lines, keyed by the same match key as
// FRANCHISE_FLAVOR. Deliberately separate from the generic pool above:
// a line built around a specific franchise joke should never be able to
// surface for an unrelated game, which is exactly what happened before
// with a Metal-Gear-only line living in the shared pool — confirmed by
// the user as showing up far too often for games that weren't Metal
// Gear at all.
const FRANCHISE_LONG_GAP_TEMPLATES: Record<string, string[]> = {
  "metal gear": [
    "The {nod} in {title} waited {longgap} quarters, but you got there. \"Kept you waiting, huh?\"",
    "{longgap} quarters of radio silence with {title}, then this {season} you finally answered the call.",
  ],
  "dark souls": [
    "{longgap} quarters between bonfires with {title} — but this {season}, you finally rang the bell.",
  ],
  "elden ring": [
    "{title} sat unfinished for {longgap} quarters. This {season}, the Tarnished rode again.",
  ],
  persona: [
    "{longgap} quarters between calendar pages in {title} — but this {season}, you finally turned the last one.",
  ],
};

// A real data gap, not a real zero: this fires when a quarter's sessions
// are all duration-less AND the underlying playthrough has no aggregate
// total to estimate from either (unlike the normal case, which
// estimateSessionHours() already backfills). Claiming "0.0h" as if it
// were a real figure reads oddly ("you wandered through it for 0.0h") —
// these lines just don't claim a duration at all, which is the more
// honest thing to say when there genuinely isn't one on record.
const NO_DURATION_TEMPLATES: string[] = [
  "{title} made an appearance this {season} — no duration on record, but it was there.",
  "You checked in on {title} this {season}. The clock didn't catch how long.",
  "{title} showed up in your {season}, {sessions} time{plural} logged — just not how long each one ran.",
  "This {season}, {title} was part of the rotation. Exact hours: unrecorded.",
  "{title} crossed your {season} at least once — the details just didn't make it into the log.",
  "Somewhere in this {season}, you spent time with {title}. How much, only you know.",
  "{title} this {season}: present, logged, undated by the hour.",
  "{title} was part of this {season}, even if the hours didn't get written down.",
  "This {season}, {title} happened — the when's on record, the how-long isn't.",
  "{title} made the {season} rotation, {sessions} time{plural} over — duration lost to history.",
];

// Franchise-specific bonus lines for regular (non-long-gap) moments.
// Concatenated onto the generic tone pool below rather than gated
// behind separate selection logic — they're just extra, more specific
// options in the same deterministic draw, so a Persona or Zelda entry
// has noticeably more variety than a franchise with no bonus pool.
const FRANCHISE_TEMPLATES: Record<string, string[]> = {
  warframe: [
    "This {season}, the {nod} in you put in {hours}h on {title} — another set of relics, another grind worth it.",
    "{title} this {season}: {hours}h as the {nod}, chasing one more piece of the build.",
  ],
  "dark souls": [
    "This {season}, {title} humbled you {sessions} times over {hours}h — the {nod} kept coming back anyway.",
    "{hours}h of {title} this {season}: mostly dying, occasionally learning.",
  ],
  "elden ring": [
    "This {season}, the {nod} rode further into {title} — {hours}h across the Lands Between.",
    "{title} this {season}: {hours}h of getting lost somewhere the map didn't cover yet.",
  ],
  bloodborne: [
    "This {season}, the {nod} in you hunted through {hours}h of {title}'s nightmare.",
    "{title} this {season}: {hours}h of Yharnam not getting any less unsettling.",
  ],
  persona: [
    "This {season}, the {nod} balanced {hours}h of {title} between social links and the Metaverse.",
    "{title} this {season}: {hours}h of calendar management with occasional demon-fusing.",
  ],
  "final fantasy": [
    "This {season}, the {nod} in you gave {title} {hours}h of the journey.",
    "{title} this {season}: {hours}h that felt exactly as long as this kind of story should.",
  ],
  "the legend of zelda": [
    "This {season}, the {nod} spent {hours}h in {title}, finding shrines you didn't need to find.",
    "{title} this {season}: {hours}h of Hyrule, one more chest before you actually stopped.",
  ],
  zelda: [
    "This {season}, the {nod} spent {hours}h in {title}, finding shrines you didn't need to find.",
    "{title} this {season}: {hours}h of Hyrule, one more chest before you actually stopped.",
  ],
  "elder scrolls": [
    "This {season}, the {nod} racked up {hours}h in {title} — half of it just wandering off the main quest.",
    "{title} this {season}: {hours}h, and you're still not sure what the main quest even was.",
  ],
  fallout: [
    "This {season}, the {nod} in you put {hours}h into {title}'s wasteland, mostly off-script.",
    "{title} this {season}: {hours}h of finding trouble that wasn't on the quest list.",
  ],
  "mass effect": [
    "This {season}, {nod} put {hours}h into {title} — paragon, renegade, or somewhere in between.",
    "{title} this {season}: {hours}h of a crew you'd follow anywhere.",
  ],
  destiny: [
    "This {season}, the {nod} logged {hours}h in {title} chasing one more roll.",
    "{title} this {season}: {hours}h, and the loot pool still wasn't done with you.",
  ],
  "metal gear": [
    "This {season}, the {nod} put in {hours}h of {title} — mostly avoiding detection, occasionally failing to.",
    "{title} this {season}: {hours}h of cardboard boxes and codec calls.",
  ],
  "monster hunter": [
    "This {season}, the {nod} spent {hours}h in {title} for one specific piece of armor.",
    "{title} this {season}: {hours}h across {sessions} hunts, most of them ending in a cart.",
  ],
  minecraft: [
    "This {season}, the {nod} in you spent {hours}h in {title} on a build that got out of hand.",
    "{title} this {season}: {hours}h, and somehow the to-do list got longer.",
  ],
  "animal crossing": [
    "This {season}, the {nod} spent {hours}h in {title} paying off a debt to a raccoon.",
    "{title} this {season}: {hours}h of watering, fishing, and rearranging furniture nobody asked about.",
  ],
  overwatch: [
    "This {season}, the {nod} logged {hours}h in {title}, blaming the healer less than usual.",
    "{title} this {season}: {hours}h across {sessions} matches, one of them actually going to plan.",
  ],
  "world of warcraft": [
    "This {season}, the {nod} put {hours}h into {title} — raid night, or close enough to it.",
    "{title} this {season}: {hours}h, and the guild chat never really stopped.",
  ],
};

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export function getFlavorText(moment: QuarterMoment): string {
  const season = SEASON_BY_QUARTER[moment.quarter];
  // Franchise is now potentially several comma-joined names (a game can
  // genuinely belong to more than one, since the GLIP unification's
  // schema normalization) — a template sentence only wants one, so this
  // takes the first rather than dumping the whole joined string into a
  // line like "the Persona,Shin Megami Tensei in you...".
  const primaryFranchise = moment.franchise?.split(",")[0]?.trim() || null;
  const franchiseKey = matchFranchiseKey(primaryFranchise, moment.title);
  const nod = franchiseNod(franchiseKey);
  const ctx: TemplateContext = {
    title: moment.title,
    franchiseOrTitle: primaryFranchise ?? moment.title,
    season,
    year: moment.year,
    hours: moment.hoursThisQuarter,
    sessions: moment.sessionCount,
    platform: moment.dominantPlatform,
    nod,
    sportPlace: sportFlavor(moment.title),
    keywordNod: keywordNod(moment.keywords ?? [], moment.collections ?? []),
  };

  if (moment.isLongGapFinish) {
    const franchisePool = franchiseKey ? FRANCHISE_LONG_GAP_TEMPLATES[franchiseKey] ?? [] : [];
    const pool = [...LONG_GAP_TEMPLATES, ...franchisePool];
    const seed = hashString(`${moment.gameId}-longgap`);
    const template = pool[seed % pool.length];
    return fill(template, ctx).replace(/\{longgap\}/g, String(moment.longGapQuarterSpan));
  }

  if (moment.hoursThisQuarter === 0) {
    const seed = hashString(`${moment.gameId}-${moment.year}-Q${moment.quarter}-nodur`);
    const template = NO_DURATION_TEMPLATES[seed % NO_DURATION_TEMPLATES.length];
    return fill(template, ctx);
  }

  const tone = classifyTone(moment.genres, moment.themes, moment.title, moment.keywords, moment.gameModes);
  const franchisePool = franchiseKey ? FRANCHISE_TEMPLATES[franchiseKey] ?? [] : [];
  const pool = [...TEMPLATES[tone], ...franchisePool];

  const gameOffset = hashString(moment.gameId) % pool.length;
  const quarterSeed = hashString(`${moment.gameId}-${moment.year}-Q${moment.quarter}`);
  const index = (gameOffset + quarterSeed) % pool.length;

  return fill(pool[index], ctx);
}
