import { hashInviteToken } from "../src/auth/kdf.js";
import { AuthRepo } from "../src/auth/repo.js";
import { db, sql } from "../src/core/db.js";
import { logger } from "../src/core/logger.js";

function parseArgs(argv: string[]): { createdBy: string; expiresAt: Date | null } {
  const args = argv.slice(2);
  let createdBy: string | undefined;
  let expiresIn: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--created-by" && args[i + 1]) {
      createdBy = args[++i];
    } else if (args[i] === "--expires-in" && args[i + 1]) {
      expiresIn = args[++i];
    }
  }

  if (!createdBy || createdBy.trim() === "") {
    process.stderr.write(
      `Usage: bun scripts/mint-invite.ts --created-by <label> [--expires-in <duration>]
  --created-by   Required. Label identifying who minted this token.
  --expires-in   Optional. Duration until expiry: e.g. 30d, 12h, 90m
`,
    );
    process.exit(2);
  }

  let expiresAt: Date | null = null;
  if (expiresIn !== undefined) {
    const match = /^(\d+)([dhm])$/.exec(expiresIn);
    if (!match) {
      process.stderr.write(
        `Invalid --expires-in value: "${expiresIn}". Supported suffixes: d (days), h (hours), m (minutes).\n`,
      );
      process.exit(2);
    }
    const amount = parseInt(match[1], 10);
    const unit = match[2];
    const now = Date.now();
    const msMap: Record<string, number> = { d: 86400000, h: 3600000, m: 60000 };
    expiresAt = new Date(now + amount * msMap[unit]);
  }

  return { createdBy: createdBy.trim(), expiresAt };
}

async function main(): Promise<void> {
  const { createdBy, expiresAt } = parseArgs(process.argv);

  const rawBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Buffer.from(rawBytes).toString("base64url").replace(/=/g, "");
  const tokenHash = hashInviteToken(Buffer.from(rawBytes));

  const repo = new AuthRepo(db);

  const { tokenId } = await repo.createInviteToken({
    tokenHash,
    createdBy,
    expiresAt,
  });

  await repo.logEvent({ userId: null, eventClass: "invite_minted" });

  logger.info(
    { tokenId, createdBy, expiresAt: expiresAt?.toISOString() ?? null },
    "invite token minted",
  );

  process.stdout.write(`${token}\n`);

  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  logger.error({ err }, "mint-invite failed");
  await sql.end().catch(() => {});
  process.exit(1);
});
