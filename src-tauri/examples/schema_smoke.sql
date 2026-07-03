CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT, "email" TEXT, "emailVerified" DATETIME, "image" TEXT,
    "wechatUnionId" TEXT, "openidWeb" TEXT, "openidMini" TEXT,
    "passwordHash" TEXT,
    "isLocal" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL, "provider" TEXT NOT NULL, "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT, "access_token" TEXT, "expires_at" INTEGER,
    "token_type" TEXT, "scope" TEXT, "id_token" TEXT, "session_state" TEXT
);

CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" DATETIME NOT NULL
);

CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" DATETIME NOT NULL
);

CREATE TABLE "Contact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "name" TEXT, "company" TEXT, "title" TEXT, "city" TEXT,
    "email" TEXT, "phone" TEXT, "wechat" TEXT, "notes" TEXT,
    "importance" TEXT NOT NULL DEFAULT 'normal',
    "reminderEnabled" INTEGER NOT NULL DEFAULT 1,
    "reminderIntervalDays" INTEGER, "lastContactedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE
);

CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE
);

CREATE TABLE "ContactTag" (
    "ownerId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    PRIMARY KEY ("contactId", "tagId"),
    FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE,
    FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE
);

CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL, "contactId" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'event',
    "startAt" DATETIME NOT NULL, "endAt" DATETIME,
    "location" TEXT,
    "notes" TEXT,
    "reminderEnabled" INTEGER NOT NULL DEFAULT 1,
    "reminderAt" DATETIME,
    "reminderLeadMinutes" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE,
    FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE SET NULL
);

CREATE TABLE "Action" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL, "contactId" TEXT,
    "parentActionId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT,
    "category" TEXT,
    "dueAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE,
    FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE SET NULL
);

CREATE TABLE "Interaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL, "contactId" TEXT NOT NULL,
    "actionId" TEXT, "eventId" TEXT,
    "occurredAt" DATETIME NOT NULL,
    "channel" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE,
    FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE
);

CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL, "contactId" TEXT NOT NULL,
    "kind" TEXT NOT NULL, "title" TEXT NOT NULL,
    "dueAt" DATETIME, "dismissedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE,
    FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE
);

CREATE TABLE "Setting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE
);

CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE
);
