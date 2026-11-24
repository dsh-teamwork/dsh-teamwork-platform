-- Pages become artifacts and plugin archives packages (docs/adr/0069-pages-become-artifacts.md).
-- Tables are renamed, not recreated, so their rows stay.
-- Drop the markdown kind's artifacts, which knowledge takes over (ADR 0068)
DELETE FROM "page_files" WHERE "version_id" IN (SELECT "id" FROM "page_versions" WHERE "page_id" IN (SELECT "id" FROM "pages" WHERE "kind" = 'markdown'));
DELETE FROM "page_versions" WHERE "page_id" IN (SELECT "id" FROM "pages" WHERE "kind" = 'markdown');
DELETE FROM "page_members" WHERE "page_id" IN (SELECT "id" FROM "pages" WHERE "kind" = 'markdown');
DELETE FROM "pages" WHERE "kind" = 'markdown';
-- Rename "pages" table to "artifacts"
ALTER TABLE "pages" RENAME TO "artifacts";
ALTER INDEX "page_team_id_owner_id_updated_at" RENAME TO "artifact_team_id_owner_id_updated_at";
ALTER INDEX "page_team_id_sharing_updated_at" RENAME TO "artifact_team_id_sharing_updated_at";
-- Rename "page_files" table to "artifact_files"
ALTER TABLE "page_files" RENAME TO "artifact_files";
ALTER INDEX "pagefile_version_id_path" RENAME TO "artifactfile_version_id_path";
ALTER INDEX "pagefile_team_id_digest" RENAME TO "artifactfile_team_id_digest";
-- Rename "page_members" table to "artifact_members"
ALTER TABLE "page_members" RENAME TO "artifact_members";
ALTER TABLE "artifact_members" RENAME COLUMN "page_id" TO "artifact_id";
ALTER INDEX "pagemember_page_id_user_id" RENAME TO "artifactmember_artifact_id_user_id";
ALTER INDEX "pagemember_user_id_page_id" RENAME TO "artifactmember_user_id_artifact_id";
-- Rename "page_versions" table to "artifact_versions"
ALTER TABLE "page_versions" RENAME TO "artifact_versions";
ALTER TABLE "artifact_versions" RENAME COLUMN "page_id" TO "artifact_id";
ALTER INDEX "pageversion_page_id_number" RENAME TO "artifactversion_artifact_id_number";
-- Rename "resource_artifacts" table to "plugin_packages"
ALTER TABLE "resource_artifacts" RENAME TO "plugin_packages";
ALTER INDEX "resourceartifact_team_id_package_version" RENAME TO "pluginpackage_team_id_package_version";
ALTER INDEX "resourceartifact_team_id_author_id" RENAME TO "pluginpackage_team_id_author_id";
-- A plugin's data names its package as packageId
UPDATE "team_configs" SET "data" = ("data" - 'artifactId') || jsonb_build_object('packageId', "data" -> 'artifactId') WHERE "data" ? 'artifactId';
UPDATE "config_revisions" SET "data" = ("data" - 'artifactId') || jsonb_build_object('packageId', "data" -> 'artifactId') WHERE "data" ? 'artifactId';
UPDATE "resource_submissions" SET "proposal" = jsonb_set("proposal" #- '{data,artifactId}', '{data,packageId}', "proposal" #> '{data,artifactId}') WHERE "proposal" #> '{data,artifactId}' IS NOT NULL;
-- A preset names the plugin's publishing tool teamwork_artifact
UPDATE "team_configs" SET "data" = replace("data"::text, '"teamwork_page"', '"teamwork_artifact"')::jsonb WHERE "data"::text LIKE '%"teamwork_page"%';
UPDATE "config_revisions" SET "data" = replace("data"::text, '"teamwork_page"', '"teamwork_artifact"')::jsonb WHERE "data"::text LIKE '%"teamwork_page"%';
UPDATE "resource_submissions" SET "proposal" = replace("proposal"::text, '"teamwork_page"', '"teamwork_artifact"')::jsonb WHERE "proposal"::text LIKE '%"teamwork_page"%';
