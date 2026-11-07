import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * H-W7: `enqueue` never throws (the caller's write already happened), but a
 * caller that must tell the user whether the follow-up job exists gets the
 * failure through `onFailure`.
 */
describe('enqueue surfaces scheduling failures through onFailure', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.REDIS_URL;
  });

  it('without REDIS_URL: resolves undefined, warns, and reports the reason', async () => {
    delete process.env.REDIS_URL;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { enqueue } = await import('@/server/queues');
    const reasons: string[] = [];
    await expect(enqueue('collapse', { ca: 'abc' }, { jobId: 'collapse-abc', onFailure: (r) => reasons.push(r) })).resolves.toBeUndefined();
    expect(reasons).toEqual(['REDIS_URL is unset: no queue is configured']);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/REDIS_URL unset: job collapse not enqueued/));
  });
});
