export type Channel = "email" | "in_app";
interface Template { channels: Channel[]; subject: (d: any) => string; text: (d: any) => string }

const both: Channel[] = ["email", "in_app"];
const email: Channel[] = ["email"];
const inApp: Channel[] = ["in_app"];
// Every entry uses one of the three typed arrays above; an inline literal would narrow to "email"[] and break `.includes` under strict.
export const TEMPLATES = {
  magic_link: { channels: email, subject: () => "Sign in to Zenhyre", text: (d) => `Click to sign in (valid 15 minutes): ${d.url}` },
  company_invite: { channels: email, subject: (d) => `Join ${d.companyName} on Zenhyre`, text: (d) => `${d.inviterName} invited you. Open this link within 7 days to accept: ${d.url}` },
  association_admin_invite: { channels: email, subject: (d) => `Your ${d.associationName} login on Zenhyre`,
    text: (d) => `Novare Talent has created your login for ${d.associationName} on Zenhyre. Log in at ${d.url} with this email address. There is no password: we email you a sign-in link each time.` },
  add_personal_email: { channels: both, subject: () => "Add a personal email before you graduate", text: () => "Your campus email will stop working. Add a personal email to keep your Zenhyre account." },
  verification_approved: { channels: both, subject: () => "You're verified on Zenhyre", text: () => "Your alumni status is confirmed. You can now apply to roles." },
  verification_rejected: { channels: both, subject: () => "We couldn't verify your alumni status", text: (d) => `Reason: ${d.reason}. You may request verification once more.` },
  role_nudge: { channels: both, subject: (d) => `A role that fits you: ${d.roleTitle}`, text: (d) => `${d.companyName} is hiring. ${d.url}` },
  application_received: { channels: inApp, subject: (d) => `Applied: ${d.roleTitle}`, text: () => "" },
  stage_changed: { channels: both, subject: (d) => `Update on ${d.roleTitle}`, text: (d) => `Status: ${d.stage}` },
  role_accepted: { channels: both, subject: (d) => `Role accepted: ${d.roleTitle}`, text: () => "Fee terms will follow shortly." },
  role_rejected: { channels: both, subject: (d) => `Role not accepted: ${d.roleTitle}`, text: (d) => `Reason: ${d.reason}. You may appeal once within 14 days.` },
  role_needs_review: { channels: both, subject: (d) => `Role under review: ${d.roleTitle}`, text: () => "Our team is reviewing it." },
  terms_released: { channels: both, subject: (d) => `Fee terms ready: ${d.roleTitle}`, text: (d) => `Review and accept: ${d.url}` },
  terms_expired: { channels: both, subject: (d) => `Role withdrawn: ${d.roleTitle}`, text: (d) => `Terms were not accepted within ${d.days ?? 14} days.` },
  shortlist_ready: { channels: both, subject: (d) => `Shortlist ready: ${d.roleTitle}`, text: (d) => `${d.count} candidates. ${d.url}` },
  broadcast_extended: { channels: both, subject: (d) => `Broadcast extended: ${d.roleTitle}`, text: (d) => `Now closes ${d.closesAt}.` },
  join_disputed: { channels: both, subject: (d) => `Joining disputed: ${d.candidateName}`, text: () => "The candidate reports they did not join. Respond within 3 days." },
  did_you_join: { channels: both, subject: (d) => `Did you join ${d.companyName}?`, text: (d) => `${d.companyName} recorded you as hired for ${d.roleTitle}. Tell us whether you joined: ${d.url}` },
  hire_recorded: { channels: both, subject: (d) => `Hire recorded: ${d.roleTitle}`, text: () => "Thanks. We'll confirm joining with the candidate." },
  role_closed: { channels: both, subject: (d) => `Role closed: ${d.roleTitle}`, text: () => "" },
  replacement_created: { channels: both, subject: (d) => `Replacement search started: ${d.roleTitle}`, text: () => "" },
  // Payments. Amounts arrive formatted ("₹23,600.00"); each email carries its GST invoice or credit note as a PDF.
  deposit_paid: { channels: both, subject: (d) => `Deposit received: ${d.roleTitle}`,
    text: (d) => `We received your deposit of ${d.total} (${d.taxable} + GST ${d.gst}) for ${d.roleTitle}. The role is now live to candidates. Invoice ${d.invoiceNumber} is attached.
${d.url}` },
  fee_raised: { channels: both, subject: (d) => `Success fee for ${d.roleTitle}: ${d.outstanding} to pay`,
    text: (d) => `Your hire for ${d.roleTitle} is recorded. Success fee ${d.feeTotal} (${d.feeTaxable} + GST ${d.feeGst}). Deposit adjusted: ${d.applied}. Balance payable: ${d.outstanding}. The ${d.guaranteeDays}-day replacement guarantee has started. Pay securely here: ${d.url}
Invoice ${d.invoiceNumber} is attached.` },
  fee_paid: { channels: both, subject: (d) => `Payment received: ${d.roleTitle}`,
    text: (d) => `We received ${d.total} towards the success fee for ${d.roleTitle}. Nothing more is due. Receipt for invoice ${d.invoiceNumber} is attached.` },
  deposit_refunded: { channels: both, subject: (d) => `Deposit refunded: ${d.roleTitle}`,
    text: (d) => `We refunded ${d.refunded} of your deposit for ${d.roleTitle}${d.gatewayFee ? ` (deposit ${d.amount}, less payment gateway charges ${d.gatewayFee})` : ""}. Banks usually credit refunds within 5–7 working days. Credit note ${d.invoiceNumber} is attached.` },
  deposit_forfeited: { channels: both, subject: (d) => `Deposit forfeited: ${d.roleTitle}`, text: (d) => `${d.amount} of the deposit for ${d.roleTitle} has been forfeited. Reason: ${d.reason}` },
  staff_alert: { channels: both, subject: (d) => `[alert] ${d.title}`, text: (d) => d.detail ?? "" },
} satisfies Record<string, Template>;
export type TemplateName = keyof typeof TEMPLATES;
