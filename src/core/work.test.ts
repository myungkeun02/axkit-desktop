import { describe, expect, it } from 'vitest';
import { decodeEvent, type AppEvent } from './events';
import { buildFeed } from './roomFeed';
import { Timeline } from './timeline';
import { decodeWork, elapsedLabel, kindLabel, openableLink, panelRows, workNoticeLabel } from './work';

describe('work (§28)', () => {
  it('reads the view, keeping unknown kinds and dropping broken rows', () => {
    const w = decodeWork({
      title: '하고 있는 일',
      active: [
        { id: 'dev:job_1', kind: 'dev', title: 'owner/repo: 파서 고치기', status: 'running', phase: '테스트 중', elapsedMinutes: 12, origin: { channelId: 'channel.app', address: 'owner' } },
        { id: 'r1', kind: 'routine', title: '아침 정리', status: 'queued', origin: { channelId: 'channel.app', address: 'bot:dev' } },
        { id: 'x', status: 'running' },
      ],
      recent: [{ id: 'b1', kind: 'browser', title: '가격 알아보기', status: 'done', summary: '마쳤어요', link: 'https://example.com/item', elapsedMinutes: 65, origin: { channelId: 'discord' } }],
    });
    expect(w.active.map((x) => [x.id, x.room])).toEqual([['dev:job_1', ''], ['r1', 'dev']]);
    expect(w.recent[0].room).toBeUndefined();
    expect(kindLabel('dev')).toBe('개발 작업');
    expect(kindLabel('routine')).toBe('routine');
    expect(elapsedLabel(w.active[0])).toBe('12분째');
    expect(elapsedLabel(w.recent[0])).toBe('1시간 5분 걸림');
    expect(openableLink('https://example.com/item')).toBe('https://example.com/item');
    expect(openableLink('feature/parser')).toBeNull();
    expect(decodeWork(null)).toEqual({ title: '하고 있는 일', active: [], recent: [] });
  });

  it('shows a work notice as the assistant talking, with a label', () => {
    const raw = { type: 'notice', seq: 2, at: '2026-11-23T05:00:00Z', kind: 'browser.task', text: '로그인 단계에서 멈췄어요.', live: { view: 'browser-live', reason: 'login' } };
    const n = decodeEvent(raw)!;
    expect(n).toMatchObject({ kind: 'browser.task', live: { view: 'browser-live' } });
    const t = new Timeline();
    t.applyAll([n, { type: 'notice', seq: 3, at: '2026-11-23T05:01:00Z', text: '밤사이 소식 3건이에요.' } as AppEvent]);
    const rows = buildFeed(t.items(''), '', { assistant: '비서', now: Date.parse('2026-11-23T06:00:00Z') });
    const entries = rows.filter((r) => r.kind === 'entry');
    expect(entries).toHaveLength(1);
    expect(entries[0].kind === 'entry' && entries[0].entry).toMatchObject({ label: '브라우저 심부름', isStatus: false, speaker: { name: '비서' } });
    expect(rows.some((r) => r.kind === 'system')).toBe(true);
    expect(workNoticeLabel('work.interrupted')).toBe('멈춘 일');
    expect(workNoticeLabel('other')).toBeUndefined();
  });
});

describe('panelRows (§31)', () => {
  const w = (id: string, status: string, parent?: string) => ({ id, kind: 'bot', title: id, status, ...(parent ? { parent } : {}) });
  it('puts running jobs on top with their sub-jobs indented, and a few finished ones below', () => {
    const view = decodeWork({
      active: [w('sub1', 'running', 'ax'), w('solo', 'queued')],
      recent: [w('ax', 'done'), w('sub0', 'done', 'ax'), w('old1', 'done'), w('old2', 'failed'), w('old3', 'done'), w('lost', 'done', 'nowhere')],
    });
    const rows = panelRows(view, 2);
    expect(rows.running.map((r) => `${r.item.id}:${r.depth}`)).toEqual(['solo:0', 'ax:0', 'sub1:1', 'sub0:1']);
    expect(rows.finished.map((r) => r.item.id)).toEqual(['old1', 'old2']);
    expect(rows.runningCount).toBe(2);
    expect(view.active[0].parent).toBe('ax');
  });
  it('survives loops and an empty view', () => {
    const view = decodeWork({ active: [w('a', 'running', 'b'), w('b', 'running', 'a'), w('c', 'running', 'c')] });
    const rows = panelRows(view);
    expect(rows.running.map((r) => r.item.id).sort()).toEqual(['a', 'b', 'c']);
    expect(panelRows(null)).toEqual({ running: [], finished: [], runningCount: 0 });
    expect(kindLabel('bot')).toBe('봇에게 맡긴 일');
  });
});
