-- Telegram notifications: the cafe's bot, each staff member's linked chat, one-time link codes.
CREATE TABLE "TelegramBot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "lastUpdateId" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TelegramBot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TelegramBot_organizationId_key" ON "TelegramBot"("organizationId");

CREATE TABLE "TelegramLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "tgUsername" TEXT,
    "prefs" JSONB NOT NULL DEFAULT '{}',
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TelegramLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TelegramLink_userId_key" ON "TelegramLink"("userId");
CREATE INDEX "TelegramLink_chatId_idx" ON "TelegramLink"("chatId");
ALTER TABLE "TelegramLink" ADD CONSTRAINT "TelegramLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TelegramLinkCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    CONSTRAINT "TelegramLinkCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TelegramLinkCode_codeHash_key" ON "TelegramLinkCode"("codeHash");
