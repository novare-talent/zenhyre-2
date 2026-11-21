# Cashfree deposits: plan

**Date:** 2026-11-21
**Status:** Built 2026-11-21 (see §11 "As built"). Waiting only on the sandbox credentials (§9) for a live test.
**Replaces:** Razorpay in spec §3.2, §9.1 and §13. The rest of the ledger design in §4.4 and §9 stays; only the gateway changes.

## 1. What we are building

A company pays a **refundable deposit** for each role **before the role goes live**. The amount comes from **slabs**: role type, the CTC the company is offering, and optionally campus reach. Slabs are rows in the database, seeded later and editable by staff. The deposit is held while hiring runs. Afterwards it is **settled** in one of three ways:

1. **Automatically by rules**, for example a full refund once the hire is complete.
2. **By a staff click** in the admin console: refund in full, refund in part, or forfeit with a note.
3. **By a manual trigger in the database**: an SQL call that queues a settlement.

All three paths write the same kind of row. One worker executes it against Cashfree, so there is one code path for moving money.

## 2. Where payment sits in the role lifecycle

The current lifecycle is kept. Payment is the only way out of `deposit_pending` apart from a staff waiver.

```
draft → gated → terms_pending → deposit_pending ──[Cashfree PAID]──→ broadcast (live) → shortlist_ready → closing → closed
                                       │  └──[staff waiver, note]──↗
                                       └─ withdrawn (any open state; a paid deposit is refunded)
```

- The company accepts the fee terms. The role moves to `deposit_pending`, the deposit amount is fixed from the slabs, and a **Pay deposit** button appears.
- The role goes to `broadcast` (visible to candidates) only once Cashfree confirms `PAID`. We confirm it through the webhook, or by checking the order with Cashfree. The browser redirect alone never counts.
- Recommended: pay **after** the gate and terms, not at submit, so a role the gate rejects never needs a refund. This is question Q1.

## 3. Deposit slabs

A new table `deposit_slab`, seeded later, editable by staff from `/staff/config`.

| Column | Meaning |
|---|---|
| `id` | uuid |
| `role_type` | `intern` / `fresher` / `experienced`, or null for any |
| `ctc_from`, `ctc_to` | Annual CTC band in paise, matched against the role's `ctc_max` (the most the company offers). `ctc_to` null means no upper limit |
| `campuses_from`, `campuses_to` | Optional band on the size of the campus reach. Null means any |
| `amount_kind` | `flat` (paise) or `percent_of_ctc` (a fraction of `ctc_max`) |
| `amount` | Paise for `flat`, or a fraction (0.05 = 5%) |
| `min_amount`, `max_amount` | Optional floor and ceiling for `percent_of_ctc` |
| `priority` | When two slabs match, the higher priority wins. Ties go to the narrower CTC band |
| `active`, `created_at`, `updated_by` | |

Rules:

- The pure function `depositForRole(slabs, role, companyStatus)` lives in `packages/roles/src/terms.ts`, next to today's `depositFor`.
  1. It finds the slab that matches.
  2. It applies the probation multiplier (`deposit.probation_multiplier`).
  3. It rounds to whole rupees.
- If no slab matches, the role cannot be paid. Staff set `role.deposit_amount` by hand, which is already allowed. Today's campus-count tiers (`deposit.tiers`) are kept only as a fallback if you want them (Q2).
- The amount is **frozen when the terms are accepted**. Editing slabs later never changes the price of a role that is already priced.
- The amount is shown to the company before they accept the terms, on the role page and in the new-role preview. It comes from the API, not the client-side copy in `apps/prototype/src/lib/rules.ts`, which is deleted.

## 4. Database changes (migration `0003_cashfree_deposits`)

All tables live in the `zenhyre2` schema, all money is `bigint` paise, and the tables are append-only where noted.

1. `deposit_mode` enum: add `cashfree`. Razorpay was never written to, so the value is left in place but unused.
2. **`deposit_slab`**, as in §3.
3. **`payment_order`**: one row per Cashfree order. A role can have several orders over time, for example after one expires, but only one active order at a time.
   - Columns: `id`, `role_id`, `company_id`, `order_id` (ours and unique, also sent to Cashfree), `cf_order_id`, `payment_session_id`, `amount`, `currency` (`INR`), and `status`.
   - `status` is one of `active`, `paid`, `expired`, `failed` or `cancelled`.
   - Payment columns, filled in when it is paid: `cf_payment_id`, `payment_method`, `paid_at`.
   - Also: `expires_at`, `customer_email`, `customer_phone`, `created_by`, `created_at`, `updated_at`, and `raw` (jsonb: the last response from Cashfree).
   - Partial unique index on `(role_id)` where `status = 'active'`.
   - Unique index on `cf_payment_id`.
4. **`deposit_settlement`**: the single entry point for moving money out of a deposit (see §6).
   - Columns: `id`, `role_id`, `kind`, `amount`, `reason`, `source`, `requested_by`, `status`, `cf_refund_id`, `failure_reason`, `requested_at`, `processed_at`, `succeeded_at`.
   - `kind` is `refund` or `forfeit`.
   - `source` is `rule:<name>`, `staff` or `db`.
   - `status` is `requested`, `processing`, `succeeded`, `failed` or `cancelled`.
   - `CHECK (amount > 0)`.
5. **`ledger_entry`**: spec §4.4, limited for now to the deposit types `deposit_received`, `deposit_refund_initiated`, `deposit_refunded` and `deposit_forfeited`. The fee and association types are added in the same enum later.
   - `CHECK (amount > 0)`.
   - Unique `(type, external_ref)` where `external_ref` is not null. This makes a replayed webhook harmless.
   - `UPDATE` and `DELETE` are revoked from `zenhyre_api`, which enforces append-only.
6. **`payment_webhook_event`**: every webhook as received.
   - Columns: `id`, `provider`, `event_type`, `dedupe_key` (unique), `signature_ok`, `payload` (jsonb), `received_at`, `processed_at`, `error`.
   - `dedupe_key` is the event type plus `cf_payment_id` or `refund_id`.
7. **DB function and trigger for manual settlements:**
   - `zenhyre2.request_deposit_settlement(role_id, kind, amount, reason, actor)`:
     - Checks that the role holds at least `amount` (held minus settlements already requested).
     - Inserts a `deposit_settlement` row with `source = 'db'`.
     - Returns its id.
   - An `AFTER INSERT` trigger on `deposit_settlement` runs `pg_notify('deposit_settlement', id)`, so the API picks it up within seconds. A one-minute sweep job is the backstop.
   - A trigger cannot call Cashfree itself, and should not, so the database only queues the request.

Derived balance, with no stored column:

```
held(role) = deposit_received − deposit_refunded − deposit_forfeited
```

Pending refunds are counted separately, so `requested + processing` can never take the role below zero.

## 5. Paying: the flow end to end

```
Company (browser)            Web app (Next.js)                 API (Hono)                          Cashfree
  │ Pay deposit ──────────→ POST /api/pay/roles/:id/deposit ─→ POST /roles/:id/deposit/order
  │                                                             lock role, check deposit_pending,
  │                                                             reuse the active order or ──────→ POST /pg/orders
  │                                                             store payment_order   ←──────── payment_session_id
  │ ←──────── { paymentSessionId, mode }
  │ Cashfree JS SDK checkout(paymentSessionId) ─────────────────────────────────────────────────→ hosted checkout
  │                                                                                ←── webhook PAYMENT_SUCCESS_WEBHOOK
  │                                                             POST /webhooks/cashfree: verify the signature,
  │                                                             dedupe, depositCaptured workflow
  │ ←─ redirect to /company/roles/:id?paid=1  → GET /roles/:id/deposit (if not yet paid: GET /pg/orders/:id)
```

- **Order creation**, `POST /roles/:id/deposit/order` (company member only):
  - It needs the role in `deposit_pending` with `deposit_mode` null or `cashfree`.
  - If an order is still active and not expired, it is returned. Otherwise a new one is created, with `order_id = dep_<role uuid without dashes>_<n>`.
  - The request sends `order_amount` in rupees with two decimals (paise / 100) and `order_currency = INR`.
  - It sends `customer_details` (company user id, email, name and **phone**; Cashfree requires the phone, see Q5).
  - It sends `order_meta.return_url = APP_BASE_URL/company/roles/:id?order_id={order_id}` and `order_meta.notify_url = APP_BASE_URL/api/webhooks/cashfree` (the public web app, which forwards to the private API).
  - It sends `order_expiry_time = now + CASHFREE_ORDER_EXPIRY_MINUTES`.
  - The Cashfree call runs **before** the database transaction, and the row is written after it succeeds. That keeps a slow HTTP call out of a locked transaction (spec §3.3). A retry reuses the same `order_id`, so it is idempotent.
- **`depositCaptured` workflow**, from the webhook or a status check:
  1. It locks the role.
  2. It checks that the amount and currency match the order.
  3. It sets `payment_order.status` to `paid`.
  4. It writes `ledger_entry deposit_received`, with `external_ref = cf_payment_id`.
  5. It sets `deposit_mode = cashfree`.
  6. It moves the role from `deposit_pending` to `broadcast` (a new `system` actor on that transition in `lifecycle.ts`) and opens the broadcast window.
  7. After commit, it enqueues `role.broadcast` and emails `deposit_captured`.
  8. If the role was already **withdrawn** when the payment arrived, it still writes `deposit_received` and immediately requests a full refund settlement (`source = rule:paid_after_withdraw`).
- **Webhook** `POST /webhooks/cashfree`:
  - It reads the raw body, then checks `base64(HMAC_SHA256(x-webhook-timestamp + rawBody, CASHFREE_SECRET_KEY))` against `x-webhook-signature` with `timingSafeEqual`.
  - It rejects a timestamp older than 5 minutes.
  - It stores the event in `payment_webhook_event`; a duplicate returns 200 without doing anything.
  - It handles `PAYMENT_SUCCESS_WEBHOOK`, `PAYMENT_FAILED_WEBHOOK`, `PAYMENT_USER_DROPPED_WEBHOOK` and `REFUND_STATUS_WEBHOOK`.
  - It always returns 200 once the event is stored, so Cashfree does not hammer us. Processing errors go to `error` and an `alert` review item.
  - In production the API refuses to start without the secret.
- **Reconciliation job**, `payment.reconcile`, every 15 minutes:
  - Orders active for more than 15 minutes are checked with `GET /pg/orders/:order_id`, which catches a webhook we missed.
  - A role in `deposit_pending` holding a `paid` order for more than `deposit.stuck_alert_hours` opens an alert.

## 6. Settling: rules, staff click, database trigger

Every settlement is a `deposit_settlement` row. The worker `deposit.settle` (LISTEN plus a one-minute sweep) takes `requested` rows with `FOR UPDATE SKIP LOCKED`:

- **refund:**
  1. The worker calls `POST /pg/orders/:order_id/refunds` with `refund_id = settlement id`, which is idempotent, `refund_amount` in rupees, and `refund_note`.
  2. It writes `deposit_refund_initiated`, and the status becomes `processing`.
  3. The `REFUND_STATUS_WEBHOOK` reports the result:
     - `SUCCESS` writes `deposit_refunded`, sets the status to `succeeded` and emails the company.
     - `FAILED` or `CANCELLED` sets the status to `failed` and opens an alert. Staff can retry, which creates a new row.
- **forfeit:** no Cashfree call. It writes `deposit_forfeited` and sets the status to `succeeded`. It needs a staff actor or `source = db` with a reason, and it is never automatic (spec §9.1).
- **Cashfree's limits:** refunds are allowed only within **6 months** of the payment. Older deposits, or an account with refunds switched off, open an alert for a manual bank transfer. Staff then record it with `kind = refund` and `cf_refund_id = 'manual:<utr>'`.
- **When nothing is held any more** and the role is `closing` with no hire, `closeRole` runs, the existing path into `closed`.

**Rules** (`resolveDeposit`, replacing today's guard). These are defaults, each can be turned off in config, and they are pending your answers in §10:

| Situation | Default outcome | Automatic? |
|---|---|---|
| Hire completed (join confirmed by the candidate, or by the 7-day grace) (Q3) | Full refund | Yes |
| Withdrawn before `broadcast` (paid but never went live) | Full refund | Yes |
| Withdrawn or no hire after the shortlist, company engaged with ≥ 50% of the shortlist | Full refund | Yes |
| No hire, engaged with some of the shortlist but < 50% | `deposit_resolution` review item, defaulting to refund | Staff confirm |
| No hire, no engagement at all ("went dark") | `deposit_resolution` review item, defaulting to forfeit | Staff confirm, with a note |
| Paid after the role was withdrawn | Full refund | Yes |
| Candidate did not join, role reopens | Nothing; the deposit stays held | — |

New config keys: `deposit.auto_refund_on_hire` (true), `deposit.auto_refund_engaged` (true), `deposit.refund_deduct_gateway_fee` (false, Q4), `deposit.settlement_mode` (`auto`, or `review` to route every rule through staff).

**Staff console** (`/staff/roles/:id`, a new **Deposit** panel):

- It shows the amount, held balance, orders and payments, settlements and ledger lines.
- Buttons: **Refund full**, **Refund part** (amount), **Forfeit** (note required), **Retry failed refund**, **Recheck with Cashfree**.
- Each button calls `POST /admin/roles/:id/deposit/settlements` or `/recheck` and is audited through `ops.audit`.
- The `deposit_resolution` queue appears under `/staff` with the same buttons.

**Manual from the database:**

```sql
select zenhyre2.request_deposit_settlement('<role uuid>', 'refund', 1500000, 'Refund agreed with client on call', 'you@novaretalent.com');
-- The API worker sends it to Cashfree within seconds. Watch it:
select status, cf_refund_id, failure_reason from zenhyre2.deposit_settlement where role_id = '<role uuid>' order by requested_at desc;
```

## 7. Web app changes

- **Company role page** (`apps/prototype/src/app/company/roles/[id]/RolePage.tsx`):
  - In `deposit_pending`, the "Novare collects the deposit" placeholder becomes a **Pay ₹X deposit** button.
  - The button asks for a phone number if we don't have one, calls the new handler, and opens Cashfree checkout with the JS SDK v3 (`https://sdk.cashfree.com/js/v3/cashfree.js`, `mode` returned by the API with each checkout).
  - On return, the page shows "Confirming payment…" and polls until the role is live.
  - It also shows the paid receipt (payment id, amount, date) and refund status later.
- **New route handler** `src/app/api/pay/roles/[id]/deposit/route.ts`:
  - It accepts same-origin requests only and has an exact path. The open `/roles/` prefix in the `zh` proxy is not widened.
  - That proxy is also hardened against `.` and `..` segments.
- **Content Security Policy** in `next.config.ts`: allow `sdk.cashfree.com` for scripts and Cashfree's checkout hosts for frames and forms.
- **Other places:**
  - The deposit is added to `needsAction` in `seats/company.tsx`.
  - The "Deposits" aside in `company/Roles.tsx` shows the real held and refunded amounts.
- **Staff:** the Deposit panel and queue described in §6.

## 8. Build order

Each step ships with tests. Cashfree is behind a `PaymentGateway` interface with a **fake** (`PAYMENT_PROVIDER=fake`), as `AUTH_PROVIDER=fake` works today, so the test suite and offline dev never touch Cashfree.

1. Schema and migration `0003`, a `packages/ledger` deposit subset with `held()` and its invariants, slab pricing, and unit tests.
2. The `PaymentGateway` interface, the Cashfree HTTP adapter (`x-client-id`, `x-client-secret`, `x-api-version`) and the fake.
3. Order creation route, `depositCaptured`, webhook route with signature, dedupe and replay tests, and the reconcile job.
4. `deposit_settlement`: worker, rules in `resolveDeposit`, hook into `confirmJoin` for hire completed, staff routes, the SQL function and trigger.
5. Web app: pay button and checkout, return polling, staff Deposit panel and queue, CSP.
6. Sandbox end-to-end run with ngrok for webhooks (see §9), then a written runbook in `HANDOVER.md`.
7. Production: live keys, domain whitelisting and webhook URL in the Cashfree dashboard, then one real ₹1 test role, refunded.

The API will load `services/api/.env` with `tsx --env-file-if-exists=.env` in its `dev` script, so the keys no longer have to be exported by hand. Production keeps using real environment variables.

## 9. Credentials and settings needed from Cashfree

From the Cashfree Merchant Dashboard, under Payment Gateway → Developers → API Keys:

| What | Where it goes | Needed for |
|---|---|---|
| **Sandbox (Test) App ID** (`x-client-id`) | `CASHFREE_APP_ID` | Building and testing now |
| **Sandbox (Test) Secret Key** (`x-client-secret`, also used to verify webhooks) | `CASHFREE_SECRET_KEY` | Building and testing now |
| Production App ID and Secret Key | the same variables, in the production environment only | Going live, after Cashfree KYC is approved |
| Confirmation that **Refunds** are enabled on the account, and whether **instant refunds** are | config | Settlement step |
| The **public URLs** we will register: API webhook `https://<api>/webhooks/cashfree`, app return `https://<app>/company/roles/…` | Cashfree dashboard → Webhooks, and domain whitelisting | Production. In sandbox, an ngrok URL |
| *(Optional)* **Payouts** App ID and Secret, a separate Cashfree product | `CASHFREE_PAYOUT_*` | Only if you want refunds older than 6 months, or bank refunds, sent from the platform instead of by hand |

Never paste the secret key into chat, a commit or the web app. It goes only into `services/api/.env` locally (gitignored) and into the host's environment settings in production.

## 10. Decisions needed from you

- **Q1. When to pay.** After gate review and terms acceptance (recommended; nothing to refund for rejected roles), or before the role is even submitted for review?
- **Q2. Slabs.** What decides the amount: role type and CTC only, or campus reach too? Please send the slab table (CTC bands, then a flat amount or a % of CTC). If no slab matches, should we block payment until staff set the amount (recommended), or fall back to today's campus tiers (₹15k / ₹30k / ₹60k)?
- **Q3. "Hiring completed".** Refund when the candidate's joining is confirmed (recommended), or only after the replacement guarantee ends (60 days after joining)? The spec netted the deposit against the success fee instead. Do you want a plain refund, with the fee invoiced separately?
- **Q4. Gateway charges.** Refund the full deposit, or the deposit minus Cashfree's processing fee?
- **Q5. Phone number.** Cashfree requires a customer phone on every order, and we don't store one today. Should we ask for it at checkout and save it on the company user (recommended), or use one company billing phone set by staff?
- **Q6. Receipts and GST.** Is a payment receipt email enough for a refundable security deposit, or do you need a GST invoice for it? This needs the finance or CA view and the invoicing entity (Novare Talent Private Limited?).
- **Q7. Forfeits.** Should forfeits always need a staff click (spec), or may a database or rule trigger forfeit on its own?

## 11. As built (2026-11-21), with the owner's answers

**Answers that shaped it.**

- **Q1:** pay after the gate and terms.
- **Q2:** reference slabs of ₹1,000 per LPA of `ctc_max`, stepped from ₹5k (base, up to 10 LPA) to ₹2L (2 Cr and above), in config `deposit.ctc_slabs`, which staff can edit at `/staff/config`. A role with no CTC falls back to the campus tiers.
- **Q3:**
  - There is no refund while the role is live.
  - A role that ends with no hire (`deposit.dark_days` after its shortlist) is refunded automatically (`deposit.auto_refund_no_hire`).
  - A role withdrawn after going live waits for finance (a `deposit_resolution` item).
  - On a hire, the fee plus GST is raised and the deposit applied to it. Any deposit beyond the fee is refunded. The company is emailed the balance with a pay link (`/company/roles/:id?pay=fee`) and pays through Cashfree.
  - When a hire does not join, the applied deposit is held again and the unpaid fee is voided.
- **Q4:** refunds are the amount less Cashfree's charge. The charge comes from Cashfree's settlement data, or is estimated as `payment.gateway_fee_rate` (1.95%) plus GST on it. It is retained once per payment, and finance can untick it. Every payment is the price plus 18% GST (`gst.rate`), shown as CGST+SGST or IGST.
- **Q5:** billing details and a phone number are asked for at the first checkout and stored in `company_billing`.
- **Q6:** every payment, fee and refund email carries a GST tax invoice or credit-note PDF, numbered `NT/INV/<FY>/00001` or `NT/CN/<FY>/00001`. The supplier details are in config `invoice.supplier`: fill in Novare's GSTIN and address.
- **Q7:** forfeits only come from finance (console or SQL), never from a rule.

**Where it lives.**

| | |
|---|---|
| Schema and migration | `packages/db/src/schema/payments.ts`, `drizzle/0003_cashfree_payments.sql` (append-only ledger trigger, `deposit_available()`, `request_deposit_settlement()`, NOTIFY trigger), `user.is_finance` |
| Ledger, gateway, GST, PDF | `packages/ledger` (`cashfreeGateway`, `fakeGateway`, `addGst`, `renderInvoicePdf`) |
| Workflows | `services/api/src/workflows/payments.ts`, hooked into `acceptTerms`, `recordHire`, `didNotJoin`, `resolveDeposit`, `withdrawRole` |
| API | `routes/payments.ts` (company), `routes/adminPayments.ts` (finance), `POST /webhooks/cashfree`, job `payment.reconcile` |
| Worker | `index.ts`: LISTEN `deposit_settlement`, plus a 1-minute sweep (`PAYMENTS_WORKER=off` disables it) |
| Web | `company/roles/[id]` (deposit sheet, fee, history, billing dialog), `company/roles/[id]/pay` (fake checkout, dev only), `staff/payments` (finance console), `api/webhooks/cashfree` (forwards to the API), `api/pay/*` (invoice PDFs) |
| Hosting | `deploy/nginx/zenhyre.conf.example`: only the web app is public; the API binds to 127.0.0.1 and holds every secret |

**Finance access:**

```sql
update zenhyre2."user" set is_finance = true where id = (select user_id from zenhyre2.user_email where email = 'you@novaretalent.com');
```

The user must also be staff (`is_staff`).
