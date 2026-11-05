export type Channel = "email" | "in_app";
interface Template { channels: Channel[]; subject: (d: any) => string; text: (d: any) => string }

const both: Channel[] = ["email", "in_app"];
const email: Channel[] = ["email"];
const inApp: Channel[] = ["in_app"];
// Every entry uses one of the three typed arrays above; an inline literal would narrow to "email"[] and break `.includes` under strict.
export const TEMPLATES = {
  magic_link: { channels: email, subject: () => "Sign in to Zenhyre", text: (d) => `Click to sign in (valid 15 minutes): ${d.url}` },
  company_invite: { channels: email, subject: (d) => `Join ${d.companyName} on Zenhyre`, text: (d) => `${d.inviterName} invited you. Accept: ${d.url}` },
  association_admin_invite: { channels: email, subject: (d) => `Admin access for ${d.associationName} on Zenhyre`, text: (d) => `Accept: ${d.url}` },
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
  terms_expired: { channels: both, subject: (d) => `Role withdrawn: ${d.roleTitle}`, text: () => "Terms were not accepted within 14 days." },
  shortlist_ready: { channels: both, subject: (d) => `Shortlist ready: ${d.roleTitle}`, text: (d) => `${d.count} candidates. ${d.url}` },
  broadcast_extended: { channels: both, subject: (d) => `Broadcast extended: ${d.roleTitle}`, text: (d) => `Now closes ${d.closesAt}.` },
  join_disputed: { channels: both, subject: (d) => `Joining disputed: ${d.candidateName}`, text: () => "The candidate reports they did not join. Respond within 3 days." },
  hire_recorded: { channels: both, subject: (d) => `Hire recorded: ${d.roleTitle}`, text: () => "Thanks. We'll confirm joining with the candidate." },
  role_closed: { channels: both, subject: (d) => `Role closed: ${d.roleTitle}`, text: () => "" },
  replacement_created: { channels: both, subject: (d) => `Replacement search started: ${d.roleTitle}`, text: () => "" },
  staff_alert: { channels: both, subject: (d) => `[alert] ${d.title}`, text: (d) => d.detail ?? "" },
} satisfies Record<string, Template>;
export type TemplateName = keyof typeof TEMPLATES;
