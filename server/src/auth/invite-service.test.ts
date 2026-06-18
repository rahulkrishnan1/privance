import { beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("../core/db.js", () => ({ db: {} }));

const mockClaimInviteToken = mock(
  async (): Promise<{ tokenId: string } | null> => ({ tokenId: "tok-uuid-1" }),
);
const mockLogEvent = mock(async (): Promise<void> => undefined);

mock.module("./repo.js", () => ({
  AuthRepo: class {
    claimInviteToken = mockClaimInviteToken;
    logEvent = mockLogEvent;
  },
}));

const { InviteService } = await import("./invite-service.js");
const { InvalidInviteError } = await import("./types.js");
const { hashInviteToken } = await import("./kdf.js");

const VALID_TOKEN_RAW = Buffer.alloc(32, 0xcd);
const VALID_TOKEN_B64 = VALID_TOKEN_RAW.toString("base64url").replace(/=/g, "");

const USER_ID = "user-uuid-test";

function makeService() {
  // biome-ignore lint/suspicious/noExplicitAny: test-only require after mock
  const { AuthRepo } = require("./repo.js") as any;
  return new InviteService({ repo: new AuthRepo() });
}

function resetMocks(): void {
  mockClaimInviteToken.mockImplementation(async () => ({ tokenId: "tok-uuid-1" }));
  mockClaimInviteToken.mockClear();
  mockLogEvent.mockImplementation(async () => undefined);
  mockLogEvent.mockClear();
}

describe("InviteService", () => {
  beforeEach(resetMocks);

  it("validateAndClaim with valid token → no error, claimInviteToken called with correct hash", async () => {
    const svc = makeService();
    await expect(
      svc.validateAndClaim({ token: VALID_TOKEN_B64, userId: USER_ID }),
    ).resolves.toBeUndefined();

    expect(mockClaimInviteToken).toHaveBeenCalledTimes(1);
    const call = (mockClaimInviteToken.mock.calls[0] as unknown as [unknown])[0] as {
      tokenHash: Buffer;
      userId: string;
    };
    const expectedHash = hashInviteToken(VALID_TOKEN_RAW);
    expect(call.tokenHash).toEqual(expectedHash);
    expect(call.userId).toBe(USER_ID);
    expect(mockLogEvent).not.toHaveBeenCalled();
  });

  it("validateAndClaim with undefined token → InvalidInviteError + signup_fail_invite_required + claimInviteToken called", async () => {
    mockClaimInviteToken.mockImplementation(async () => null);
    const svc = makeService();

    let thrown: unknown;
    try {
      await svc.validateAndClaim({ token: undefined, userId: USER_ID });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(InvalidInviteError);
    expect(mockClaimInviteToken.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(mockLogEvent).toHaveBeenCalledWith({
      userId: null,
      eventClass: "signup_fail_invite_required",
    });
  });

  it("validateAndClaim with empty string token → InvalidInviteError + signup_fail_invite_required + claimInviteToken called", async () => {
    mockClaimInviteToken.mockImplementation(async () => null);
    const svc = makeService();

    let thrown: unknown;
    try {
      await svc.validateAndClaim({ token: "", userId: USER_ID });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(InvalidInviteError);
    expect(mockClaimInviteToken.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(mockLogEvent).toHaveBeenCalledWith({
      userId: null,
      eventClass: "signup_fail_invite_required",
    });
  });

  it("validateAndClaim with malformed token (non-base64url chars) -> InvalidInviteError + signup_fail_invite_invalid + claimInviteToken called", async () => {
    mockClaimInviteToken.mockImplementation(async () => null);
    const svc = makeService();

    let thrown: unknown;
    try {
      await svc.validateAndClaim({ token: "!!!not-base64url!!!", userId: USER_ID });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(InvalidInviteError);
    expect(mockClaimInviteToken.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(mockLogEvent).toHaveBeenCalledWith({
      userId: null,
      eventClass: "signup_fail_invite_invalid",
    });
  });

  it("validateAndClaim with wrong decoded length (3 bytes, AAAA) -> InvalidInviteError + signup_fail_invite_invalid + claimInviteToken called", async () => {
    mockClaimInviteToken.mockImplementation(async () => null);
    const svc = makeService();

    let thrown: unknown;
    try {
      await svc.validateAndClaim({ token: "AAAA", userId: USER_ID });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(InvalidInviteError);
    expect(mockClaimInviteToken.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(mockLogEvent).toHaveBeenCalledWith({
      userId: null,
      eventClass: "signup_fail_invite_invalid",
    });
  });

  it("validateAndClaim with valid-shape token but no matching row -> InvalidInviteError + signup_fail_invite_invalid", async () => {
    mockClaimInviteToken.mockImplementation(async () => null);
    const svc = makeService();

    let thrown: unknown;
    try {
      await svc.validateAndClaim({ token: VALID_TOKEN_B64, userId: USER_ID });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(InvalidInviteError);
    expect(mockClaimInviteToken.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(mockLogEvent).toHaveBeenCalledWith({
      userId: null,
      eventClass: "signup_fail_invite_invalid",
    });
  });

  it("validateAndClaim passes now through to claimInviteToken", async () => {
    const svc = makeService();
    const fixedNow = new Date("2030-01-01T00:00:00Z");
    await svc.validateAndClaim({ token: VALID_TOKEN_B64, userId: USER_ID, now: fixedNow });

    expect(mockClaimInviteToken).toHaveBeenCalledTimes(1);
    const call = (mockClaimInviteToken.mock.calls[0] as unknown as [unknown])[0] as { now: Date };
    expect(call.now).toBe(fixedNow);
  });
});
