-- Staff ↔ prep station assignment (baristas see the Coffee station, etc.)
CREATE TABLE "UserStation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    CONSTRAINT "UserStation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserStation_userId_stationId_key" ON "UserStation"("userId", "stationId");
CREATE INDEX "UserStation_stationId_idx" ON "UserStation"("stationId");
ALTER TABLE "UserStation" ADD CONSTRAINT "UserStation_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserStation" ADD CONSTRAINT "UserStation_stationId_fkey"
    FOREIGN KEY ("stationId") REFERENCES "KitchenStation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
