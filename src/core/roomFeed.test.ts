import { describe, expect, it } from 'vitest';
import { cardTitle, cleanText, parseBotTalk, previewText } from './chatText';
import type { MessageEvent, NoticeEvent } from './events';
import { findRange, matches, snippet } from './koreanSearch';
import { buildFeed, type Row } from './roomFeed';
import type { Item } from './timeline';

const now = Date.parse('2026-11-20T03:00:00Z');
const notice = (seq: number, text: string, at = '2026-11-20T01:00:00Z'): Item => ({ kind: 'notice', seq, event: { type: 'notice', seq, at, text, channel: '개발' } as NoticeEvent });
const msg = (seq: number, text: string, o: { author?: string; owner?: boolean; at?: string } = {}): Item => ({ kind: 'message', seq,
  event: { type: 'message', seq, at: o.at ?? '2026-11-20T01:00:00Z', role: o.owner ? 'owner' : 'assistant', text, channel: '개발', author: o.author ? { id: o.author, name: o.author } : undefined } as MessageEvent });
const lead = { id: 'engineering', name: 'Leo' };
const entries = (rows: Row[]) => rows.flatMap((r) => (r.kind === 'entry' ? [r.entry] : []));

describe('cleanText', () => {
  it('drops Discord leftovers', () => {
    expect(cleanText('<@123456789> 확인했어요 :white_check_mark:')).toBe('확인했어요 ✅');
    expect(cleanText('이상한 :not_a_code: 코드')).toBe('이상한 코드');
    expect(cleanText('https://example.com/a:b 오후 3:20')).toBe('https://example.com/a:b 오후 3:20');
    expect(cleanText('보고 — #일상에 알림')).toBe('보고 — 일상 방에 알림');
    expect(cleanText('PR #712 반영')).toBe('PR #712 반영');
    expect(cleanText('[https://a.com/__%EC%97%86%EB%8A%94] 화면')).toBe('[https://a.com/__없는] 화면');
  });
  it('cuts metadata and prompt blocks, internal ids and role words', () => {
    expect(cleanText('빼자고 했어요.\n\neventId: 8648\nsource: slack\n<knowledge_x>\n- 비밀\n</knowledge_x>')).toBe('빼자고 했어요.');
    expect(cardTitle('eventId: 8648', '빼자고 했어요.\neventId: 1\nfrom: x')).toBe('빼자고 했어요.');
    expect(cleanText('🛠️ Engineer 시작: 로그인 · v2-ax-qa-web-4ac6f8339bea2b7d · ax/qa-web-4ac6f8339bea2b7d-2026-11-18')).toBe('🛠️ 개발 봇 시작: 로그인');
    expect(cleanText('넘겼어요 (작업 37ac4816): 홈')).toBe('넘겼어요: 홈');
    expect(cleanText('⚠️ ⚠️ 정리됨')).toBe('⚠️ 정리됨');
    expect(cleanText('## 결론\n> 인용\n```\ncode\n```')).toBe('**결론**\n인용\ncode');
  });
  it('previews in one line', () => { expect(previewText('**굵게**\n- 하나\n- 둘')).toBe('굵게 · 하나 · 둘'); });
  it('parses bot talk', () => {
    expect(parseBotTalk('💬 Leo → Mia · 검토 요청: 바꿔도 될까요?')).toMatchObject({ from: 'Leo', to: 'Mia', label: '검토 요청', isReply: false });
    expect(parseBotTalk('↩️ Mia → Leo · 답 (승인): 좋아요.')?.isReply).toBe(true);
    expect(parseBotTalk('🛠️ Engineer 시작: 하나')).toBeNull();
  });
});

describe('buildFeed', () => {
  it('folds replies under the question', () => {
    const rows = buildFeed([notice(1, '💬 Leo → Mia · 검토 요청: 될까요?'), notice(2, '↩️ Mia → Leo · 답 (승인): 좋아요.')], '개발', { lead, assistant: '비서', now });
    expect(rows[0]).toMatchObject({ kind: 'day', label: '오늘' });
    const list = entries(rows);
    expect(list).toHaveLength(1);
    expect(list[0].replies.map((r) => r.speaker.name)).toEqual(['Mia']);
  });
  it('gives authorless notices to the lead and groups a run', () => {
    const list = entries(buildFeed([notice(1, 'Engineer 시작: 하나'), notice(2, '끝: 하나'), msg(3, '제가 볼게요', { author: 'Nora' }), msg(4, '부탁해요', { owner: true })], '개발', { lead, assistant: '비서', now }));
    expect(list.map((e) => e.speaker.name)).toEqual(['Leo', 'Leo', 'Nora', '나']);
    expect(list.map((e) => e.showHeader)).toEqual([true, false, true, true]);
    expect(list[0].isStatus).toBe(true);
  });
  it('folds long runs keeping the newest two', () => {
    const rows = buildFeed([1, 2, 3, 4, 5, 6].map((i) => notice(i, `작업 ${i}`)), '개발', { lead, assistant: '비서', now });
    expect(rows[1]).toMatchObject({ kind: 'folded', fold: { title: '이전 작업 기록 4개' } });
    expect(entries(rows).map((e) => e.text)).toEqual(['작업 5', '작업 6']);
  });
  it('folds a long run from one bot', () => {
    const rows = buildFeed([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => msg(i, `✅ ${i}단계`, { author: 'Leo' })), '개발', { lead, assistant: '비서', now });
    expect(rows[1]).toMatchObject({ kind: 'folded', fold: { title: 'Leo의 이전 글 7개' } });
    expect(entries(buildFeed([1, 2, 3, 4, 5].map((i) => msg(i, `글 ${i}`, { author: 'Leo' })), '개발', { lead, assistant: '비서', now }))).toHaveLength(5);
  });
  it('marks repeats and days', () => {
    const rows = buildFeed([notice(1, '같은 글', '2026-11-18T01:00:00Z'), notice(2, '같은 글', '2026-11-18T01:00:05Z'), msg(3, '안녕', { author: 'Leo', at: '2026-11-19T01:00:00Z' })], '개발', { lead, assistant: '비서', now });
    expect(rows.filter((r) => r.kind === 'day').map((r) => (r as { label: string }).label)).toEqual(['11월 18일 수요일', '어제']);
    expect(entries(rows)[0].repeats).toBe(2);
  });
  it('folds a thread under its first line', () => {
    const t = (seq: number, text: string): Item => { const i = msg(seq, text, { author: 'Leo' }); (i as { event: MessageEvent }).event.thread = { id: 'th1', title: '로그인 확인' }; return i; };
    const list = entries(buildFeed([t(1, '맡았어요'), msg(2, '다른 말', { author: 'Nora' }), t(3, '📋 계획'), t(4, '🏁 결과')], '개발', { lead, assistant: '비서', now }));
    expect(list.map((e) => e.text)).toEqual(['맡았어요', '다른 말']);
    expect(list[0].replies.map((e) => e.text)).toEqual(['📋 계획', '🏁 결과']);
    expect(list[0].threadTitle).toBe('로그인 확인');
  });
  it('keeps main-room notices as system lines', () => {
    expect(buildFeed([notice(1, '알림')], '', { assistant: '비서', now })[1].kind).toBe('system');
  });
});

describe('koreanSearch', () => {
  it('ignores spaces and marks, matches parts and first sounds', () => {
    expect(matches('결제/PG 정리', '결제pg')).toBe(true);
    expect(matches('결제 화면', 'ㄱㅈ')).toBe(true);
    expect(matches('법무', 'ㄱㅈ')).toBe(false);
    const t = '토스 본인 확인 계약';
    const r = findRange(t, '본인확인')!;
    expect(t.slice(r[0], r[1])).toBe('본인 확인');
    expect(snippet('# 제목\n- **토스 본인확인**: 아직', '본인확인')).toBe('토스 본인확인: 아직');
  });
});
