CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT, "email" TEXT, "email_verified" DATETIME, "image" TEXT,
    "wechat_union_id" TEXT, "openid_web" TEXT, "openid_mini" TEXT,
    "password_hash" TEXT,
    "is_local" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL, "provider" TEXT NOT NULL, "provider_account_id" TEXT NOT NULL,
    "refresh_token" TEXT, "access_token" TEXT, "expires_at" INTEGER,
    "token_type" TEXT, "scope" TEXT, "id_token" TEXT, "session_state" TEXT
);

CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "session_token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires" DATETIME NOT NULL
);

CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" DATETIME NOT NULL
);

CREATE TABLE "Contact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "name" TEXT, "company" TEXT, "title" TEXT, "city" TEXT,
    "email" TEXT, "phone" TEXT, "wechat" TEXT, "notes" TEXT,
    "importance" TEXT NOT NULL DEFAULT 'normal',
    "reminder_enabled" INTEGER NOT NULL DEFAULT 1,
    "reminder_interval_days" INTEGER, "last_contacted_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE
);

CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE
);

CREATE TABLE "ContactTag" (
    "user_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    PRIMARY KEY ("contact_id", "tag_id"),
    FOREIGN KEY ("contact_id") REFERENCES "Contact" ("id") ON DELETE CASCADE,
    FOREIGN KEY ("tag_id") REFERENCES "Tag" ("id") ON DELETE CASCADE
);

CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL, "contact_id" TEXT,
    "title" TEXT NOT NULL,
    "event_type" TEXT NOT NULL DEFAULT 'event',
    "start_at" DATETIME NOT NULL, "end_at" DATETIME,
    "location" TEXT,
    "notes" TEXT,
    "reminder_enabled" INTEGER NOT NULL DEFAULT 1,
    "reminder_at" DATETIME,
    "project_id" TEXT REFERENCES "Project"("id") ON DELETE SET NULL,
    "reminder_lead_minutes" INTEGER,
    "archived_at" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE,
    FOREIGN KEY ("contact_id") REFERENCES "Contact" ("id") ON DELETE SET NULL
);

CREATE TABLE "Action" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL, "contact_id" TEXT,
    "parent_action_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT,
    "category" TEXT,
    "due_at" DATETIME,
    "completed_at" DATETIME,
    "project_id" TEXT REFERENCES "Project"("id") ON DELETE SET NULL,
    "archived_at" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE,
    FOREIGN KEY ("contact_id") REFERENCES "Contact" ("id") ON DELETE SET NULL
);

CREATE TABLE "Interaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL, "contact_id" TEXT NOT NULL,
    "action_id" TEXT, "event_id" TEXT,
    "occurred_at" DATETIME NOT NULL,
    "channel" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE,
    FOREIGN KEY ("contact_id") REFERENCES "Contact" ("id") ON DELETE CASCADE
);

CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL, "description" TEXT,
    "template" TEXT NOT NULL, "stage" TEXT NOT NULL,
    "start_at" DATETIME, "due_at" DATETIME, "completed_at" DATETIME,
    "archived_at" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE
);

CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL, "contact_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL, "title" TEXT NOT NULL,
    "due_at" DATETIME, "dismissed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE,
    FOREIGN KEY ("contact_id") REFERENCES "Contact" ("id") ON DELETE CASCADE
);

CREATE TABLE "Setting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT,
    "updated_at" DATETIME NOT NULL,
    FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE
);

CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE
);
