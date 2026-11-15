-- Modify "usage_requests" table
ALTER TABLE "usage_requests" ADD COLUMN "deadline_at" timestamptz NULL;
-- Create "budget_notices" table
CREATE TABLE "budget_notices" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "team_id" character varying NOT NULL, "window_id" character varying NOT NULL, "recipient_id" character varying NOT NULL, "threshold" bigint NOT NULL, "data" jsonb NOT NULL, "state" character varying NOT NULL DEFAULT 'pending', "lease_id" character varying NOT NULL DEFAULT '', "lease_until" timestamptz NULL, "next_at" timestamptz NOT NULL, "attempts" bigint NOT NULL DEFAULT 0, "last_error" character varying NOT NULL DEFAULT '', PRIMARY KEY ("id"));
-- Create index "budgetnotice_state_next_at" to table: "budget_notices"
CREATE INDEX "budgetnotice_state_next_at" ON "budget_notices" ("state", "next_at");
-- Create index "budgetnotice_window_id_recipient_id_threshold" to table: "budget_notices"
CREATE UNIQUE INDEX "budgetnotice_window_id_recipient_id_threshold" ON "budget_notices" ("window_id", "recipient_id", "threshold");
