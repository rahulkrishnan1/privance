ALTER TABLE "users" ADD COLUMN "wrapped_dek_recovery" "bytea" NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "wrapped_dek_recovery_iv" "bytea" NOT NULL;