-- Modify "usage_requests" table
ALTER TABLE "usage_requests" ADD COLUMN "host_id" character varying NOT NULL DEFAULT '';
