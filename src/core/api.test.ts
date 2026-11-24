import { describe, expect, it } from 'vitest';
import { ApiClient, ApiError, errorText, type RawReply, type Transport } from './api';

const reply = (r: RawReply): Transport => ({ call: async () => r, upload: async () => r });

describe('ApiClient errors', () => {
  it("shows the Mac's own reason for a refusal when it sends one", async () => {
    const api = new ApiClient(reply({ status: 400, body: { ok: false, error: 'shape', message: '결재 없이 하라는 내용은 넣을 수 없어요.' } }));
    const e = (await api.viewAction('bots', 'setInstructions', {}).catch((x: unknown) => x)) as ApiError;
    expect(e.kind).toBe('badRequest');
    expect(errorText(e, '대신')).toBe('결재 없이 하라는 내용은 넣을 수 없어요.');
  });
  it('falls back to the screen\'s own words, then the generic line', async () => {
    const api = new ApiClient(reply({ status: 400, body: { ok: false, error: 'shape' } }));
    const e = (await api.viewAction('bots', 'setInstructions', {}).catch((x: unknown) => x)) as ApiError;
    expect(errorText(e, '이 글은 넣을 수 없어요.')).toBe('이 글은 넣을 수 없어요.');
    expect(errorText(e)).toBe('보낸 내용을 맥이 이해하지 못했어요.');
  });
  it('treats a non-JSON 401 as offline, not as "not allowed"', async () => {
    const api = new ApiClient(reply({ status: 401, body: null }));
    await expect(api.status()).rejects.toMatchObject({ kind: 'offline' });
  });
});
