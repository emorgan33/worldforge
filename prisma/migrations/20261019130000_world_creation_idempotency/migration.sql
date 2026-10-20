ALTER TABLE "World" ADD COLUMN "creationRequestId" TEXT;
ALTER TABLE "World" ADD COLUMN "creationPayloadHash" TEXT;
CREATE UNIQUE INDEX "World_ownerId_creationRequestId_key" ON "World"("ownerId", "creationRequestId");
