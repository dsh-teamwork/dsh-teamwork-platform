-- Drop "shared_hosts" table
DROP TABLE "shared_hosts";
-- Drop "shared_host_members" table
DROP TABLE "shared_host_members";
-- Drop "shared_archive_segments" table
DROP TABLE "shared_archive_segments";
-- Modify "usage_requests" table
ALTER TABLE "usage_requests" DROP COLUMN "host_id";
-- Modify "page_versions" table
ALTER TABLE "page_versions" DROP COLUMN "host_id";
