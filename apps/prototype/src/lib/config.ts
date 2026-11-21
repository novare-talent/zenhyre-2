// Server-only: reads the platform's real config defaults (spec §17) from the ops package source,
// so the prototype's numbers cannot drift from the backend. Passed to the client as plain data.
import { CONFIG } from "@zenhyre/ops/src/defaults";
import type { Rules } from "./rules";

export function rulesFromConfig(): Rules {
  const d = <K extends keyof typeof CONFIG>(k: K): (typeof CONFIG)[K]["default"] => CONFIG[k].default;
  return {
    depositTiers: d("deposit.tiers").map((t) => ({ maxCampuses: t.max_campuses, amount: t.amount })),
    depositCtcSlabs: d("deposit.ctc_slabs").map((s) => ({ ctcFrom: s.ctc_from, ctcTo: s.ctc_to, amount: s.amount })),
    gstRate: d("gst.rate"),
    engagedThreshold: d("deposit.engaged_threshold"),
    darkDays: d("deposit.dark_days"),
    internFlat: d("fee.intern_flat"),
    percentDefault: d("fee.percent_default"),
    percentSenior: d("fee.percent_senior"),
    seniorYears: d("fee.senior_years"),
    replacementDays: d("fee.replacement_days"),
    dueDaysAfterJoin: d("fee.due_days_after_join"),
    blocklist: [...d("gate.blocklist")],
    minCtc: { ...d("gate.min_ctc") },
    termsTimeoutDays: d("gate.terms_timeout_days"),
    appealWindowDays: d("gate.appeal_window_days"),
    broadcastDays: d("match.broadcast_days"),
    shortlistCap: d("match.shortlist_cap"),
    nudgeCap: d("match.nudge_cap"),
    escapeHatchDays: d("identity.escape_hatch_days"),
    freemailDomains: [...d("identity.freemail_domains")],
    maxVerificationAttempts: d("identity.max_verification_attempts"),
    shareRate: 0.15, // Association.share_rate default (spec §4.1)
  };
}
