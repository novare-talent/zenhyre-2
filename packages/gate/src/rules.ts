// §7 stage 1: the rules pass. Pure and dependency-free, so the API's gate job and the web app's
// "will this pass?" preview run the same code. Money is integer paise; CTC is annual.

export type RoleType = "intern" | "fresher" | "experienced";

/** The fields of a role the gate reads. `campusReach` holds whatever identifies a campus to the caller (ids or short codes). */
export interface GateRole {
  title: string;
  jd: string;
  type: RoleType | null | undefined;
  ctcMin: number | null | undefined;
  ctcMax: number | null | undefined;
  locations: string[];
  campusReach: string[];
}

/** From config: `gate.blocklist`, `gate.min_ctc`. */
export interface RulesConfig {
  blocklist: readonly string[];
  minCtc: Readonly<Record<RoleType, number>>;
}

export const RULES = { category: "Role category", required: "Required fields", minCtc: "Minimum CTC" } as const;
export type RuleName = (typeof RULES)[keyof typeof RULES];

/** What any gate stage returns. Stage 1 only ever accepts or rejects; `needs_review` comes from the model stage. */
export interface GateOutcome {
  outcome: "accept" | "reject" | "needs_review";
  /** Set on a stage-1 reject: the rule that decided. */
  rule?: RuleName;
  reason: string;
}
export type RulesOutcome = GateOutcome & { outcome: "accept" | "reject" };

export const MIN_JD_CHARS = 200;
const ROLE_TYPES: readonly string[] = ["intern", "fresher", "experienced"];

/** Whole-phrase match, so "bpo" does not fire inside another word and "field  sales" still matches across odd spacing. */
function mentions(haystack: string, phrase: string): boolean {
  const words = phrase.trim().toLowerCase().split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return false;
  return new RegExp(`(^|[^a-z0-9])${words.join("[\\s-]+")}([^a-z0-9]|$)`).test(haystack);
}

/** Annual paise to a short lakh figure: 240000000 → "₹24 LPA". */
export function lpa(paise: number): string {
  const lakhs = paise / 100 / 100000;
  return `₹${Number.isInteger(lakhs) ? lakhs : lakhs.toFixed(1)} LPA`;
}

/** Instant, and a reject names the rule. A pass (`accept`) hands the role to stage 2. */
export function evaluateRules(role: GateRole, config: RulesConfig): RulesOutcome {
  const reject = (rule: RuleName, reason: string): RulesOutcome => ({ outcome: "reject", rule, reason });

  const hay = `${role.title} ${role.jd}`.toLowerCase();
  const blocked = config.blocklist.find((b) => mentions(hay, b));
  if (blocked) return reject(RULES.category, `"${blocked}" roles are not a fit for IIT talent.`);

  const jdLength = role.jd.trim().length;
  if (jdLength < MIN_JD_CHARS) return reject(RULES.required, `The description needs at least ${MIN_JD_CHARS} characters (it has ${jdLength}).`);
  if (!role.type || !ROLE_TYPES.includes(role.type)) return reject(RULES.required, "Choose a role type: intern, fresher or experienced.");
  if (!role.ctcMin || !role.ctcMax || role.ctcMax < role.ctcMin) return reject(RULES.required, "Add a CTC band, lowest figure first.");
  if (role.locations.filter((l) => l.trim()).length < 1) return reject(RULES.required, "Add at least one location.");
  if (role.campusReach.length < 1) return reject(RULES.required, "Switch on at least one campus.");

  const floor = config.minCtc[role.type];
  if (role.ctcMin < floor) return reject(RULES.minCtc, `The floor for ${role.type} roles is ${lpa(floor)}. This band starts at ${lpa(role.ctcMin)}.`);

  return { outcome: "accept", reason: "Passed the rules." };
}
