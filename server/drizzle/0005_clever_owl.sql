CREATE TABLE "prices" (
	"source" text NOT NULL,
	"ticker" text NOT NULL,
	"price" numeric(24, 8) NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prices_source_ticker_pk" PRIMARY KEY("source","ticker")
);
