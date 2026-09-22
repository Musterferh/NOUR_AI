ALTER TABLE "Session" ADD COLUMN "ownerId" TEXT NOT NULL DEFAULT 'private';
ALTER TABLE "Session" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'Mode 1 (Teach)';
ALTER TABLE "Message" ADD COLUMN "turnId" TEXT;
ALTER TABLE "Message" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'complete';
ALTER TABLE "Message" ADD COLUMN "sources" TEXT NOT NULL DEFAULT '[]';
CREATE INDEX "Session_ownerId_updatedAt_idx" ON "Session"("ownerId", "updatedAt");
CREATE INDEX "Message_sessionId_createdAt_idx" ON "Message"("sessionId", "createdAt");
CREATE UNIQUE INDEX "Message_sessionId_turnId_role_key" ON "Message"("sessionId", "turnId", "role");
CREATE TABLE "ExamAttempt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "questions" TEXT NOT NULL,
  "answers" TEXT NOT NULL DEFAULT '{}',
  "sources" TEXT NOT NULL DEFAULT '[]',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" DATETIME NOT NULL,
  "submittedAt" DATETIME,
  "score" REAL
);
CREATE INDEX "ExamAttempt_ownerId_startedAt_idx" ON "ExamAttempt"("ownerId", "startedAt");
CREATE TABLE "UsageBucket" ("id" TEXT NOT NULL PRIMARY KEY, "count" INTEGER NOT NULL DEFAULT 0, "expiresAt" DATETIME NOT NULL);
CREATE INDEX "UsageBucket_expiresAt_idx" ON "UsageBucket"("expiresAt");
CREATE TABLE "RequestLease" ("id" TEXT NOT NULL PRIMARY KEY, "token" TEXT NOT NULL, "expiresAt" DATETIME NOT NULL);
CREATE TABLE "AuthSession" ("id" TEXT NOT NULL PRIMARY KEY, "ownerId" TEXT NOT NULL, "expiresAt" DATETIME NOT NULL);
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");
