import { describe, expect, it } from 'vitest';
import { memoryStorage, Outbox } from './outbox';

let n = 0;
const ids = () => `id${++n}`;
const wait = () => ({ wait: true as const });

describe('Outbox', () => {
  it('sends in order with a stable clientId and keeps the rest while it has to wait', async () => {
    const box = new Outbox(memoryStorage(), 'local', ids);
    box.enqueue('a', '');
    box.enqueue('b', 'dev');
    box.enqueue('c', '');
    const sent: string[] = [];
    let fail = true;
    const send = async (p: { id: string; text: string }) => {
      if (p.text === 'b' && fail) throw new Error('offline');
      sent.push(`${p.id}:${p.text}`);
    };
    const r1 = await box.flush(send, wait);
    expect(r1.waiting).toBe(true);
    expect(box.pending.map((p) => p.text)).toEqual(['b', 'c']);
    const bId = box.pending[0].id;
    fail = false;
    await box.flush(send, wait);
    expect(sent).toEqual([expect.stringMatching(/:a$/), `${bId}:b`, expect.stringMatching(/:c$/)]);
    expect(box.pending).toHaveLength(0);
  });

  it('keeps a refused message, marked, and sends the rest; the owner can send it again or delete it', async () => {
    const box = new Outbox(memoryStorage(), 'local', ids);
    box.enqueue('bad', '');
    box.enqueue('good', '');
    const sent: string[] = [];
    const r = await box.flush(async (p) => { if (p.text === 'bad') throw new Error('shape'); sent.push(p.text); }, () => ({ wait: false, reason: '맥이 받지 않았어요.' }));
    expect(r.failed.map((p) => p.text)).toEqual(['bad']);
    expect(sent).toEqual(['good']);
    expect(box.pending).toMatchObject([{ text: 'bad', failed: '맥이 받지 않았어요.' }]);
    expect(box.waiting).toHaveLength(0);
    const id = box.pending[0].id;
    box.retry(id);
    expect(box.waiting.map((p) => p.id)).toEqual([id]);
    await box.flush(async () => {}, wait);
    expect(box.pending).toHaveLength(0);
    box.enqueue('gone', '');
    box.remove(box.pending[0].id);
    expect(box.pending).toHaveLength(0);
  });

  it('never drops what the owner wrote, even numbers that look like a code', async () => {
    const box = new Outbox(memoryStorage(), 'local', ids);
    box.enqueue('150000원 보내줘', '', 0);
    const sent: string[] = [];
    await box.flush(async (p) => { sent.push(p.text); }, wait);
    expect(sent).toEqual(['150000원 보내줘']);
  });

  it('keeps one list per server and survives a restart', () => {
    const storage = memoryStorage();
    new Outbox(storage, 'local', ids).enqueue('later', '');
    const box = new Outbox(storage, 'local', ids);
    expect(box.pending.map((p) => p.text)).toEqual(['later']);
    box.useScope('remote:macmini.ts.net');
    expect(box.pending).toHaveLength(0);
    box.useScope('local');
    expect(box.pending.map((p) => p.text)).toEqual(['later']);
  });
});
