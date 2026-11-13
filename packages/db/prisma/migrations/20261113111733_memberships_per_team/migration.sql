/*
  Warnings:

  - The primary key for the `memberships` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- AlterTable
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_pkey",
ADD CONSTRAINT "memberships_pkey" PRIMARY KEY ("user_id", "team_id");
