/**
 * Create an association login (§6.5). Association accounts are never self-served: Novare staff create
 * the association for a campus if it does not exist yet, and make the given address one of its admins.
 * The address can then log in at /login as an association; the sign-in link proves they own it.
 *
 *   pnpm --filter @zenhyre/api issue:association -- --campus IITD --email admin@alumni.example \
 *        [--name "IIT Delhi Alumni Association"] [--share 0.15] [--payout cash|sponsorship_credit] [--by staff@novare.example]
 *
 * Without RESEND_API_KEY the notice to the admin is printed here instead of being emailed.
 */
import { createDb } from "@zenhyre/db";
import { systemClock } from "@zenhyre/shared";
import { ConsoleTransport, ResendTransport } from "@zenhyre/notify";
import { buildDeps } from "../context";
import { assertFreeFor } from "../oneRole";
import { authFromEnv } from "../auth/fromEnv";

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i > -1 ? args[i + 1] : undefined; };
const campusCode = opt("campus"), email = opt("email")?.toLowerCase(), name = opt("name"), by = opt("by");
const share = Number(opt("share") ?? "0.15");
const payout = (opt("payout") ?? "cash") as "cash" | "sponsorship_credit";
if (!campusCode || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !(share >= 0 && share <= 1) || !["cash", "sponsorship_credit"].includes(payout)) {
  console.error("usage: issue:association -- --campus <SHORTCODE> --email <admin email> [--name <association name>] [--share 0.15] [--payout cash|sponsorship_credit] [--by <staff email>]");
  process.exit(1);
}

const { db, close } = createDb();
try {
  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const transport = process.env.RESEND_API_KEY
    ? new ResendTransport(process.env.RESEND_API_KEY, process.env.MAIL_FROM ?? "Zenhyre <no-reply@zenhyre.com>")
    : new ConsoleTransport();
  const { identity, notify, ops } = await buildDeps({ db, clock: systemClock, transport, baseUrl, auth: authFromEnv() });

  const campus = await identity.campusByShortCode(campusCode);
  if (!campus) throw new Error(`No campus with short code ${campusCode}. Run pnpm db:seed, or check the code.`);
  const staffId = by ? await identity.userIdForEmail(by) : null;
  if (by && !staffId) throw new Error(`${by} has never signed in, so it cannot be recorded as the inviter.`);

  let association = await identity.associationForCampus(campus.id);
  if (!association) {
    if (!name) throw new Error(`${campus.name} has no association yet. Pass --name to create it.`);
    association = await identity.createAssociation({ campusId: campus.id, name, shareRate: share, payoutMode: payout });
    if (staffId) await ops.audit(staffId, "association.create", "association", association.id);
    console.log(`Created "${association.name}" for ${campus.name} (share ${share * 100}%, ${payout}).`);
  }
  const existing = await identity.userIdForEmail(email);
  if (existing) await assertFreeFor(identity, existing, "association"); // one email, one role
  const grant = await identity.grantAssociationAdmin({ associationId: association.id, invitedBy: staffId, email });
  await notify.sendToEmail(email, "association_admin_invite", { associationName: association.name, url: `${baseUrl}/login?as=association` });
  if (staffId) await ops.audit(staffId, "association.grant_admin", "association", association.id, email);
  console.log(grant.pending
    ? `Access granted: ${email} becomes an admin of "${association.name}" the first time they log in at ${baseUrl}/login as an association.`
    : `Access granted: ${email} is now an admin of "${association.name}". They log in at ${baseUrl}/login as an association.`);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await close();
}
