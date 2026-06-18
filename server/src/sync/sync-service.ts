import type { SyncRepo } from "./repo.js";
import type {
  BatchInput,
  BatchResult,
  ChangesResult,
  DeleteInput,
  GetResult,
  PutInput,
  PutResult,
} from "./types.js";

export class SyncService {
  private readonly repo: SyncRepo;

  constructor(opts: { repo: SyncRepo }) {
    this.repo = opts.repo;
  }

  async put(input: PutInput): Promise<PutResult> {
    return this.repo.put({
      userId: input.userId,
      objectId: input.objectId,
      kind: input.kind,
      ciphertext: input.ciphertext,
      nonce: input.nonce,
      version: input.version,
      ...(input.prevVersion !== undefined ? { prevVersion: input.prevVersion } : {}),
    });
  }

  async get(opts: { userId: string; objectId: string }): Promise<GetResult> {
    return this.repo.get(opts);
  }

  async delete(input: DeleteInput): Promise<void> {
    await this.repo.delete(input);
  }

  async changes(opts: { userId: string; since: bigint; limit: number }): Promise<ChangesResult> {
    return this.repo.changes(opts);
  }

  async batch(input: BatchInput): Promise<BatchResult> {
    return this.repo.batch(input);
  }
}
