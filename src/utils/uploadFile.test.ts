// src/utils/uploadFile.test.ts
//
// The cancellation is the point, not the error.
//
// `uploadWatch.test.ts` proves WHEN an upload counts as stuck. This proves what happens then —
// which is the half that left two files in the live bucket that no document points at.

import { describe, it, expect, vi, beforeEach } from 'vitest';

type Handlers = {
  next: (s: { bytesTransferred: number; totalBytes: number }) => void;
  error: (e: unknown) => void;
  complete: () => void;
};

const task = {
  handlers: null as Handlers | null,
  cancelled: 0,
  /** How many times the SDK was asked to start an upload. A refusal must leave this at 0. */
  started: 0,
  on(_event: string, next: Handlers['next'], error: Handlers['error'], complete: Handlers['complete']) {
    task.handlers = { next, error, complete };
  },
  cancel() {
    task.cancelled++;
  },
};

vi.mock('../firebase', () => ({ storage: {} }));
vi.mock('firebase/storage', () => ({
  ref: (_s: unknown, path: string) => ({ path }),
  uploadBytesResumable: () => { task.started++; return task; },
  getDownloadURL: async (r: { path: string }) => 'https://example.test/' + r.path,
}));

const { uploadFile, UploadStalled, UploadRefused } = await import('./uploadFile');

beforeEach(() => {
  task.handlers = null;
  task.cancelled = 0;
  task.started = 0;
});

/** Let the watchdog's own interval run. */
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('an upload that stops moving', () => {
  it('is cancelled, not merely reported', () => {
    // The defect, in one assertion. `Promise.race` rejected and left the upload running, so the
    // person was told it failed while the file arrived anyway and no document was ever written for
    // it. One of the two orphans measured in the live bucket is under `assets/`, which is that path.
    return new Promise<void>((done, fail) => {
      uploadFile('assets/u1/x.png', new Blob(['x']), { stallMs: 100 }).then(
        () => fail(new Error('should not have resolved')),
        (err) => {
          try {
            expect(err).toBeInstanceOf(UploadStalled);
            expect(task.cancelled).toBe(1);
            done();
          } catch (e) { fail(e); }
        },
      );
    });
  });

  it('does not give up while bytes are still moving', async () => {
    let settled: string | null = null;
    const p = uploadFile('assets/u1/big.png', new Blob(['x']), { stallMs: 300 })
      .then(() => { settled = 'ok'; })
      .catch(() => { settled = 'failed'; });

    // Slower than the stall window end to end, but never quiet for that long.
    for (let i = 1; i <= 5; i++) {
      await settle(150);
      task.handlers!.next({ bytesTransferred: i * 1000, totalBytes: 10_000 });
    }
    expect(settled).toBe(null);
    expect(task.cancelled).toBe(0);

    task.handlers!.complete();
    await p;
    expect(settled).toBe('ok');
  });

  it('reports progress as a percentage while it runs', async () => {
    const seen: (number | null)[] = [];
    const p = uploadFile('assets/u1/x.png', new Blob(['x']), { stallMs: 5000, onProgress: (n) => seen.push(n) });
    await settle(10);
    task.handlers!.next({ bytesTransferred: 2_500, totalBytes: 10_000 });
    task.handlers!.next({ bytesTransferred: 10_000, totalBytes: 10_000 });
    task.handlers!.complete();
    await p;
    expect(seen).toEqual([25, 100, 100]);
  });

  it('returns the download URL when it finishes', async () => {
    const p = uploadFile('assets/u1/done.png', new Blob(['x']), { stallMs: 5000 });
    await settle(10);
    task.handlers!.complete();
    await expect(p).resolves.toBe('https://example.test/assets/u1/done.png');
  });

  it('passes a real failure through untouched, and cancels nothing', async () => {
    const p = uploadFile('assets/u1/x.png', new Blob(['x']), { stallMs: 5000 });
    await settle(10);
    const boom = new Error('storage/unauthorized');
    task.handlers!.error(boom);
    await expect(p).rejects.toBe(boom);
    expect(task.cancelled).toBe(0);
  });

  it('does not cancel after it has already finished', async () => {
    const p = uploadFile('assets/u1/x.png', new Blob(['x']), { stallMs: 100 });
    await settle(10);
    task.handlers!.complete();
    await p;
    await settle(250); // past the stall window
    expect(task.cancelled).toBe(0);
  });
});

describe('a file Storage would refuse', () => {
  // The refusal used to happen at the far end, after every byte had been sent. On a phone, on
  // mobile data, with a 12 MB photo. And then the banner offered to do it again.
  it('is not uploaded at all', async () => {
    const big = { size: 12 * 1024 * 1024, type: 'image/jpeg' } as unknown as Blob;
    Object.setPrototypeOf(big, Blob.prototype);
    await expect(uploadFile('chat-images/g1/u1_1_photo.jpg', big)).rejects.toBeInstanceOf(UploadRefused);
    expect(task.started, 'the SDK must not be asked to start an upload that cannot land').toBe(0);
  });

  it('carries why, so the caller can say something true about it', async () => {
    const big = { size: 12 * 1024 * 1024, type: 'image/jpeg' } as unknown as Blob;
    Object.setPrototypeOf(big, Blob.prototype);
    const err = await uploadFile('chat-images/g1/u1_1_photo.jpg', big).catch((e) => e);
    expect(err.refusal).toEqual({ kind: 'too-large', maxBytes: 10 * 1024 * 1024, size: 12 * 1024 * 1024 });
  });

  it("uses the explicit contentType over the blob one, since that is what the SDK sends", async () => {
    const data = { size: 10, type: 'image/png' } as unknown as Blob;
    Object.setPrototypeOf(data, Blob.prototype);
    const err = await uploadFile('chat-images/g1/u1_1.png', data, { contentType: 'application/pdf' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(UploadRefused);
    expect(err.refusal.kind).toBe('wrong-type');
  });

  it('leaves an upload it knows nothing about alone', async () => {
    // No limit for this root, so nothing here may stand in the way of it being attempted.
    const p = uploadFile('unknown-root/x.bin', new Blob(['x']), { stallMs: 50 });
    await settle(5);
    expect(task.started).toBe(1);
    task.handlers!.complete();
    await expect(p).resolves.toContain('unknown-root');
  });
});
