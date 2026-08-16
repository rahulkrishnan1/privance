const env = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);
delete env.TRUSTED_PROXY_HOPS;
env.ENUMERATION_SECRET ??= Buffer.alloc(32, 0x42).toString("base64");

const subprocess = Bun.spawn(["bun", "--no-env-file", "test"], {
  cwd: `${import.meta.dir}/..`,
  env,
  stderr: "inherit",
  stdout: "inherit",
});

process.exit(await subprocess.exited);
