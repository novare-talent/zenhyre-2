CREATE TYPE "zenhyre2"."invoice_kind" AS ENUM('tax_invoice', 'credit_note');--> statement-breakpoint
CREATE TYPE "zenhyre2"."ledger_type" AS ENUM('deposit_received', 'deposit_refunded', 'deposit_gateway_fee_retained', 'deposit_forfeited', 'deposit_applied_to_fee', 'deposit_application_reversed', 'fee_due', 'fee_paid', 'fee_voided');--> statement-breakpoint
CREATE TYPE "zenhyre2"."payment_order_status" AS ENUM('active', 'paid', 'failed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "zenhyre2"."payment_purpose" AS ENUM('deposit', 'fee');--> statement-breakpoint
CREATE TYPE "zenhyre2"."settlement_kind" AS ENUM('refund', 'forfeit');--> statement-breakpoint
CREATE TYPE "zenhyre2"."settlement_status" AS ENUM('requested', 'processing', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
ALTER TYPE "zenhyre2"."deposit_mode" ADD VALUE 'cashfree';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zenhyre2"."company_billing" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"legal_name" text NOT NULL,
	"gstin" text,
	"address" text NOT NULL,
	"state" text NOT NULL,
	"state_code" text NOT NULL,
	"phone" text NOT NULL,
	"email" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zenhyre2"."deposit_settlement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"payment_order_id" uuid NOT NULL,
	"kind" "zenhyre2"."settlement_kind" NOT NULL,
	"amount" bigint NOT NULL,
	"deduct_gateway_fee" boolean DEFAULT true NOT NULL,
	"gateway_fee" bigint DEFAULT 0 NOT NULL,
	"reason" text NOT NULL,
	"source" text NOT NULL,
	"requested_by" text NOT NULL,
	"status" "zenhyre2"."settlement_status" DEFAULT 'requested' NOT NULL,
	"cf_refund_id" text,
	"failure_reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"succeeded_at" timestamp with time zone,
	CONSTRAINT "deposit_settlement_amount_ck" CHECK (amount > 0 and gateway_fee >= 0 and gateway_fee < amount)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zenhyre2"."invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"kind" "zenhyre2"."invoice_kind" NOT NULL,
	"role_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"payment_order_id" uuid,
	"settlement_id" uuid,
	"lines" jsonb NOT NULL,
	"taxable" bigint NOT NULL,
	"cgst" bigint DEFAULT 0 NOT NULL,
	"sgst" bigint DEFAULT 0 NOT NULL,
	"igst" bigint DEFAULT 0 NOT NULL,
	"total" bigint NOT NULL,
	"billing" jsonb NOT NULL,
	"supplier" jsonb NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zenhyre2"."invoice_counter" (
	"series" text PRIMARY KEY NOT NULL,
	"last" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zenhyre2"."ledger_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "zenhyre2"."ledger_type" NOT NULL,
	"role_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"match_id" uuid,
	"payment_order_id" uuid,
	"settlement_id" uuid,
	"amount" bigint NOT NULL,
	"tax" bigint DEFAULT 0 NOT NULL,
	"external_ref" text,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entry_amount_ck" CHECK (amount > 0 and tax >= 0 and tax <= amount)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zenhyre2"."payment_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" text NOT NULL,
	"purpose" "zenhyre2"."payment_purpose" NOT NULL,
	"role_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"match_id" uuid,
	"taxable" bigint NOT NULL,
	"gst" bigint NOT NULL,
	"total" bigint NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" "zenhyre2"."payment_order_status" DEFAULT 'active' NOT NULL,
	"provider" text NOT NULL,
	"cf_order_id" text,
	"payment_session_id" text,
	"cf_payment_id" text,
	"payment_method" text,
	"paid_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"billing" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw" jsonb,
	CONSTRAINT "payment_order_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "payment_order_total_ck" CHECK (total > 0 and total = taxable + gst)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zenhyre2"."payment_webhook_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_type" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "payment_webhook_event_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "zenhyre2"."user" ADD COLUMN "is_finance" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."company_billing" ADD CONSTRAINT "company_billing_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "zenhyre2"."company"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."deposit_settlement" ADD CONSTRAINT "deposit_settlement_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "zenhyre2"."role"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."deposit_settlement" ADD CONSTRAINT "deposit_settlement_payment_order_id_payment_order_id_fk" FOREIGN KEY ("payment_order_id") REFERENCES "zenhyre2"."payment_order"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."invoice" ADD CONSTRAINT "invoice_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "zenhyre2"."role"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."invoice" ADD CONSTRAINT "invoice_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "zenhyre2"."company"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."invoice" ADD CONSTRAINT "invoice_payment_order_id_payment_order_id_fk" FOREIGN KEY ("payment_order_id") REFERENCES "zenhyre2"."payment_order"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."invoice" ADD CONSTRAINT "invoice_settlement_id_deposit_settlement_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "zenhyre2"."deposit_settlement"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."ledger_entry" ADD CONSTRAINT "ledger_entry_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "zenhyre2"."role"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."ledger_entry" ADD CONSTRAINT "ledger_entry_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "zenhyre2"."company"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."ledger_entry" ADD CONSTRAINT "ledger_entry_payment_order_id_payment_order_id_fk" FOREIGN KEY ("payment_order_id") REFERENCES "zenhyre2"."payment_order"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."ledger_entry" ADD CONSTRAINT "ledger_entry_settlement_id_deposit_settlement_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "zenhyre2"."deposit_settlement"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."payment_order" ADD CONSTRAINT "payment_order_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "zenhyre2"."role"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."payment_order" ADD CONSTRAINT "payment_order_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "zenhyre2"."company"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deposit_settlement_role_idx" ON "zenhyre2"."deposit_settlement" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deposit_settlement_status_idx" ON "zenhyre2"."deposit_settlement" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_role_idx" ON "zenhyre2"."invoice" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_order_kind_uq" ON "zenhyre2"."invoice" USING btree ("payment_order_id","kind") WHERE settlement_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_settlement_uq" ON "zenhyre2"."invoice" USING btree ("settlement_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_entry_role_idx" ON "zenhyre2"."ledger_entry" USING btree ("role_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_entry_ref_uq" ON "zenhyre2"."ledger_entry" USING btree ("type","external_ref") WHERE external_ref is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_order_role_idx" ON "zenhyre2"."payment_order" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_order_active_uq" ON "zenhyre2"."payment_order" USING btree ("role_id","purpose") WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_order_cf_payment_uq" ON "zenhyre2"."payment_order" USING btree ("cf_payment_id");--> statement-breakpoint
-- The ledger is append-only: corrections are new entries, never edits.
CREATE OR REPLACE FUNCTION "zenhyre2"."ledger_entry_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entry is append-only: write a reversing entry instead';
END $$;--> statement-breakpoint
CREATE TRIGGER "ledger_entry_no_change" BEFORE UPDATE OR DELETE ON "zenhyre2"."ledger_entry"
  FOR EACH ROW EXECUTE FUNCTION "zenhyre2"."ledger_entry_append_only"();--> statement-breakpoint
-- What a role's deposit still holds: received (and re-held) minus refunded, retained, forfeited and applied,
-- minus settlements already requested or in flight.
CREATE OR REPLACE FUNCTION "zenhyre2"."deposit_available"(p_role uuid) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT sum(CASE WHEN type IN ('deposit_received', 'deposit_application_reversed') THEN amount
                                   WHEN type IN ('deposit_refunded', 'deposit_gateway_fee_retained', 'deposit_forfeited', 'deposit_applied_to_fee') THEN -amount
                                   ELSE 0 END)
                   FROM "zenhyre2"."ledger_entry" WHERE role_id = p_role), 0)
       - coalesce((SELECT sum(amount) FROM "zenhyre2"."deposit_settlement"
                   WHERE role_id = p_role AND status IN ('requested', 'processing')), 0)
$$;--> statement-breakpoint
-- Manual settlement from SQL (the finance team's "DB trigger"). Queues the request; the API's worker sends refunds to
-- Cashfree and records forfeits. p_amount null = everything still held.
--   select zenhyre2.request_deposit_settlement('<role id>', 'refund', null, 'Client asked for an early refund', 'you@novaretalent.com');
CREATE OR REPLACE FUNCTION "zenhyre2"."request_deposit_settlement"(
  p_role uuid, p_kind text, p_amount bigint, p_reason text, p_actor text, p_deduct_gateway_fee boolean DEFAULT true
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_available bigint;
  v_order uuid;
  v_id uuid;
BEGIN
  IF p_kind NOT IN ('refund', 'forfeit') THEN RAISE EXCEPTION 'kind must be refund or forfeit'; END IF;
  IF coalesce(trim(p_reason), '') = '' OR coalesce(trim(p_actor), '') = '' THEN RAISE EXCEPTION 'a reason and an actor are required'; END IF;
  PERFORM 1 FROM "zenhyre2"."role" WHERE id = p_role FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'role % not found', p_role; END IF;
  SELECT id INTO v_order FROM "zenhyre2"."payment_order"
    WHERE role_id = p_role AND purpose = 'deposit' AND status = 'paid' ORDER BY paid_at DESC LIMIT 1;
  IF v_order IS NULL THEN RAISE EXCEPTION 'role % has no paid deposit', p_role; END IF;
  v_available := "zenhyre2"."deposit_available"(p_role);
  IF coalesce(p_amount, v_available) <= 0 THEN RAISE EXCEPTION 'nothing is held on role %', p_role; END IF;
  IF coalesce(p_amount, v_available) > v_available THEN
    RAISE EXCEPTION 'only % paise is available on role %', v_available, p_role;
  END IF;
  INSERT INTO "zenhyre2"."deposit_settlement" (role_id, payment_order_id, kind, amount, deduct_gateway_fee, reason, source, requested_by)
    VALUES (p_role, v_order, p_kind::"zenhyre2"."settlement_kind", coalesce(p_amount, v_available),
            p_kind = 'refund' AND p_deduct_gateway_fee, p_reason, 'db', p_actor)
    RETURNING id INTO v_id;
  RETURN v_id;
END $$;--> statement-breakpoint
-- Wakes the API's settlement worker as soon as a request is queued, by any path.
CREATE OR REPLACE FUNCTION "zenhyre2"."deposit_settlement_notify"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('deposit_settlement', NEW.id::text);
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "deposit_settlement_requested" AFTER INSERT ON "zenhyre2"."deposit_settlement"
  FOR EACH ROW EXECUTE FUNCTION "zenhyre2"."deposit_settlement_notify"();
