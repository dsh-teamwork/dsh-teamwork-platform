-- Create "knowledge_comments" table
CREATE TABLE `knowledge_comments` (`id` text NOT NULL, `created_at` datetime NOT NULL, `team_id` text NOT NULL, `document_id` text NOT NULL, `parent_id` text NOT NULL DEFAULT (''), `author_id` text NOT NULL, `version` integer NOT NULL, `quote` text NOT NULL DEFAULT (''), `anchor` text NOT NULL DEFAULT (''), `body` text NOT NULL, `resolved_by` text NOT NULL DEFAULT (''), `resolved_at` datetime NULL, PRIMARY KEY (`id`));
-- Create index "knowledgecomment_document_id_created_at" to table: "knowledge_comments"
CREATE INDEX `knowledgecomment_document_id_created_at` ON `knowledge_comments` (`document_id`, `created_at`);
-- Create index "knowledgecomment_author_id" to table: "knowledge_comments"
CREATE INDEX `knowledgecomment_author_id` ON `knowledge_comments` (`author_id`);
