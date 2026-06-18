// Bun test preload: runs before any test module (and thus before the rate-limit
// singleton initializes), so password-verify throttling tests get a small,
// deterministic window regardless of which test file loads the module first.
process.env.RATE_LIMIT_PASSWORD_VERIFY ??= "3";
