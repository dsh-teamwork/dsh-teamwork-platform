-- Modify "usage_requests" table
ALTER TABLE "usage_requests" ADD COLUMN "meter" character varying NOT NULL DEFAULT '', ADD COLUMN "quantity" bigint NULL;
