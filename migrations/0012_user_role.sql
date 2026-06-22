-- better-auth Admin plugin columns (https://better-auth.com/docs/plugins/admin).
-- The plugin extends the user table with role/banned/banReason/banExpires and the session
-- table with impersonatedBy. Column types follow the plugin's schema.d.ts and this repo's
-- existing SQLite boolean convention (INTEGER 0/1, like emailVerified / isAnonymous).
--
-- role defaults to 'user'; SQLite ALTER TABLE ... DEFAULT backfills every existing row with
-- 'user', so the admin gate treats "no role" and "user" identically. Granting admin is a
-- deliberate, out-of-migration step — the app owner runs it against their own row by email:
--   UPDATE "user" SET "role" = 'admin' WHERE "email" = '...';
-- (intentionally NOT seeded here — no personal data belongs in a schema migration).
ALTER TABLE "user" ADD COLUMN "role" TEXT DEFAULT 'user';
ALTER TABLE "user" ADD COLUMN "banned" INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE "user" ADD COLUMN "banReason" TEXT;
ALTER TABLE "user" ADD COLUMN "banExpires" TEXT;
ALTER TABLE "session" ADD COLUMN "impersonatedBy" TEXT;
