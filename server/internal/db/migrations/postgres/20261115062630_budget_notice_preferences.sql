-- Modify "budget_policies" table
ALTER TABLE "budget_policies" ADD COLUMN "notify" character varying NOT NULL DEFAULT 'admins';
