import { describe, expect, it, mock } from "bun:test";

// Mock the auth KDF so verifyAuthHash is deterministic without hashing.
const mockVerifyAuthHash = mock(async (): Promise<boolean> => true);
mock.module("../auth/kdf.js", () => ({
  verifyAuthHash: mockVerifyAuthHash,
}));

import { AccountService } from "./account-service.js";
import { InvalidPasswordError } from "./types.js";

const STORED_HASH = Buffer.from("$argon2id$v=19$m=65536,t=3,p=4$abc$def", "utf8");

function makeRepo() {
  return {
    getUserAuthHashById: mock(async (): Promise<Buffer | null> => STORED_HASH),
    destroyUser: mock(async (): Promise<void> => undefined),
  };
}

describe("AccountService.destroy", () => {
  it("verifies the password then deletes all data for the user", async () => {
    mockVerifyAuthHash.mockResolvedValueOnce(true);
    const repo = makeRepo();
    const svc = new AccountService({ repo: repo as never });

    const result = await svc.destroy({
      userId: "user-1",
      currentAuthHash: Buffer.alloc(64, 0xab),
    });

    expect(result).toEqual({ userId: "user-1" });
    expect(repo.getUserAuthHashById).toHaveBeenCalledWith({ userId: "user-1" });
    expect(repo.destroyUser).toHaveBeenCalledWith({ userId: "user-1" });
    expect(repo.destroyUser).toHaveBeenCalledTimes(1);
  });

  it("rejects a wrong password and deletes nothing", async () => {
    mockVerifyAuthHash.mockResolvedValueOnce(false);
    const repo = makeRepo();
    const svc = new AccountService({ repo: repo as never });

    await expect(
      svc.destroy({ userId: "user-1", currentAuthHash: Buffer.alloc(64, 0x00) }),
    ).rejects.toBeInstanceOf(InvalidPasswordError);

    expect(repo.destroyUser).not.toHaveBeenCalled();
  });

  it("rejects when the user no longer exists and deletes nothing", async () => {
    mockVerifyAuthHash.mockResolvedValueOnce(true);
    const repo = makeRepo();
    repo.getUserAuthHashById.mockResolvedValueOnce(null);
    const svc = new AccountService({ repo: repo as never });

    await expect(
      svc.destroy({ userId: "ghost", currentAuthHash: Buffer.alloc(64, 0xab) }),
    ).rejects.toBeInstanceOf(InvalidPasswordError);

    expect(repo.destroyUser).not.toHaveBeenCalled();
  });
});
