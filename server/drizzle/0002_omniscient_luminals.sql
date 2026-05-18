CREATE TABLE "symbol_profiles" (
	"ticker" text PRIMARY KEY NOT NULL,
	"asset_type" text NOT NULL,
	"display_name" text,
	"figi" text,
	"cusip" text,
	"isin" text,
	"asset_class" text,
	"asset_sub_class" text,
	"sector" text,
	"industry" text,
	"country" text,
	"region" text,
	"currency" text,
	"exchange" text,
	"last_refreshed_at" timestamp with time zone DEFAULT now() NOT NULL
);
