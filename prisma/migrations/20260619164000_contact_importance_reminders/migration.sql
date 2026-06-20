ALTER TABLE "Contact"
  ADD COLUMN "importance" TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN "reminderEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "reminderIntervalDays" INTEGER;

CREATE INDEX "Contact_ownerId_importance_idx" ON "Contact"("ownerId", "importance");
CREATE INDEX "Contact_ownerId_reminderEnabled_lastContactedAt_idx" ON "Contact"("ownerId", "reminderEnabled", "lastContactedAt");
