-- Pot-based bounty fields: total pot, slot cap, min spend per claim.
-- Additive only.

ALTER TABLE "Deal"
    ADD COLUMN "bountyPotAmount" DOUBLE PRECISION,
    ADD COLUMN "bountyMaxInvites" INTEGER,
    ADD COLUMN "bountyMinSpend" DOUBLE PRECISION;
