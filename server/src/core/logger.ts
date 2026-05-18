import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "privance-server" },
  redact: {
    paths: [
      "*.password",
      "*.masterPassword",
      "*.dek",
      "*.itemsKey",
      "*.authHash",
      "*.recoveryPhrase",
      "*.recoverySeed",
      "*.ciphertext",
    ],
    censor: "[REDACTED]",
  },
});
