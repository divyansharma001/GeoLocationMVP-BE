-- BOGO ("Buy N Get M") deal fields + DealTypeMaster row.
-- Additive only.

ALTER TABLE "Deal"
    ADD COLUMN "bogoBuyQuantity" INTEGER,
    ADD COLUMN "bogoGetQuantity" INTEGER,
    ADD COLUMN "bogoGetDiscountPercent" DOUBLE PRECISION;

INSERT INTO "DealTypeMaster" ("name", "description", "active", "createdAt", "updatedAt")
VALUES (
    'BOGO',
    'Buy-N-Get-M deal: customer buys a quantity to unlock another at a discount (or free)',
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO UPDATE SET
    "description" = EXCLUDED."description",
    "active" = true,
    "updatedAt" = CURRENT_TIMESTAMP;
