-- Better Auth anonymous plugin: track guest users before they link Google.
ALTER TABLE "user" ADD COLUMN "isAnonymous" INTEGER DEFAULT FALSE;
