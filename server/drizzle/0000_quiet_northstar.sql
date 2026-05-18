CREATE TABLE "sync_objects" (
	"user_id" text NOT NULL,
	"object_id" text NOT NULL,
	"kind" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"nonce" "bytea" NOT NULL,
	"version" bigint NOT NULL,
	"server_seq" bigserial NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tombstone" boolean DEFAULT false NOT NULL,
	CONSTRAINT "sync_objects_user_id_object_id_pk" PRIMARY KEY("user_id","object_id")
);
--> statement-breakpoint
CREATE INDEX "sync_objects_user_seq_idx" ON "sync_objects" USING btree ("user_id","server_seq");