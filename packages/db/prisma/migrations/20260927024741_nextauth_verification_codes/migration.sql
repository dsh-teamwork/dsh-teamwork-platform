-- CreateTable
CREATE TABLE "verification_codes" (
    "id" TEXT NOT NULL DEFAULT nanoid(),
    "email" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "verification_codes_email_created_at_idx" ON "verification_codes"("email", "created_at");
