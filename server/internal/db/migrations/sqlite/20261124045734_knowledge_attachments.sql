-- Create "knowledge_attachments" table
CREATE TABLE `knowledge_attachments` (`id` text NOT NULL, `created_at` datetime NOT NULL, `team_id` text NOT NULL, `document_id` text NOT NULL, `name` text NOT NULL, `content_type` text NOT NULL, `size` integer NOT NULL, `digest` text NOT NULL, `created_by` text NOT NULL, PRIMARY KEY (`id`));
-- Create index "knowledgeattachment_document_id_name" to table: "knowledge_attachments"
CREATE UNIQUE INDEX `knowledgeattachment_document_id_name` ON `knowledge_attachments` (`document_id`, `name`);
-- Create index "knowledgeattachment_team_id_digest" to table: "knowledge_attachments"
CREATE INDEX `knowledgeattachment_team_id_digest` ON `knowledge_attachments` (`team_id`, `digest`);
