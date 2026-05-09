-- Migration: add_menuitem_peoplecount_bulkorder
-- Adds columns used by the schema: defaultPeopleCount, minPeopleCount, isBulkOrderEnabled

ALTER TABLE "MenuItem"
  ADD COLUMN IF NOT EXISTS "isBulkOrderEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "defaultPeopleCount" INTEGER,
  ADD COLUMN IF NOT EXISTS "minPeopleCount" INTEGER;

-- Ensure an index for bulk-enabled queries if desired (no-op if exists)
-- CREATE INDEX IF NOT EXISTS "MenuItem_merchantId_isBulkOrderEnabled_idx"
-- ON "MenuItem"("merchantId", "isBulkOrderEnabled");
