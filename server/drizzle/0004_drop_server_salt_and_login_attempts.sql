-- Remove write-only server_salt column (never read; salt is embedded in argon2id encoded hash).
ALTER TABLE "users" DROP COLUMN "server_salt";--> statement-breakpoint
-- Remove dead login_attempts table (rate limiting is in-memory; this table was never read).
DROP TABLE IF EXISTS "login_attempts";--> statement-breakpoint
DROP INDEX IF EXISTS "login_attempts_user_time_idx";
