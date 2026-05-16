import type { SyncRepo } from "./repo.js";
import type {
  BatchDeleteItem,
  BatchInput,
  BatchPutItem,
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
    const result = await this.repo.put({
      userId: input.userId,
      objectId: input.objectId,
      kind: input.kind,
      ciphertext: input.ciphertext,
      nonce: input.nonce,
      version: input.version,
      ...(input.prevVersion !== undefined ? { prevVersion: input.prevVersion } : {}),
    });
    await this.repo.logEvent({ userId: input.userId, event: "sync.put" });
    return result;
  }

  async get(opts: { userId: string; objectId: string }): Promise<GetResult> {
    return this.repo.get(opts);
  }

  async delete(input: DeleteInput): Promise<void> {
    await this.repo.delete(input);
    await this.repo.logEvent({ userId: input.userId, event: "sync.delete" });
  }

  async changes(opts: { userId: string; since: bigint; limit: number }): Promise<ChangesResult> {
    return this.repo.changes(opts);
  }

  async batch(input: BatchInput): Promise<BatchResult> {
    const putResults = await this.repo.batchPut(input.userId, input.puts as BatchPutItem[]);
    const deleteResults = await this.repo.batchDelete(
      input.userId,
      input.deletes as BatchDeleteItem[],
    );
    await this.repo.logEvent({ userId: input.userId, event: "sync.batch" });
    return { results: [...putResults, ...deleteResults] };
  }
}
