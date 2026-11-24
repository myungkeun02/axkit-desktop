import { describe, expect, it } from 'vitest';
import { afterDone, closedLabel, forgetSiteMessage, handsOver, hostOf, liveKeyFor, mentionsHandover, reasonLabel, toJpegPoint, toJpegScroll } from './browserLive';

describe('browser-live (§22)', () => {
  it('turns a click on the shown picture into JPEG pixels', () => {
    // 824×1720 JPEG shown at 412×860: everything doubles.
    expect(toJpegPoint(206, 430, 412, 860, 824, 1720)).toEqual({ x: 412, y: 860 });
    expect(toJpegPoint(-5, 2000, 412, 860, 824, 1720)).toEqual({ x: 0, y: 1719 });
    expect(toJpegScroll(100, 430, 1720)).toBe(400);
    expect(toJpegScroll(5000, 430, 1720)).toBe(4000);
  });
  it('speaks plainly about why and how it closed', () => {
    expect(reasonLabel('login')).toBe('로그인이 필요해요');
    expect(reasonLabel('weird')).toBe('직접 해 주셔야 하는 단계예요');
    expect(closedLabel('idle')).toContain('15분');
    expect(closedLabel(undefined)).toBeNull();
  });
  it("finds the hand-over sentence in the assistant's reply", () => {
    expect(mentionsHandover("로그인에서 멈췄어요. 앱의 브라우저 화면에서 직접 하실 수 있어요. 다 하셨으면 그 화면에서 '다 했어요'를 눌러 주세요.")).toBe(true);
    expect(mentionsHandover('브라우저로 찾아봤어요')).toBe(false);
    // The owner's own line after 'done' gets no button.
    expect(mentionsHandover('(앱의 브라우저 화면에서 직접 마쳤어요: shop.example.com) 계속해 주세요.')).toBe(false);
  });
  it('matches the iPhone app wording and helpers', () => {
    expect(reasonLabel('payment')).toBe('마지막 결제 버튼은 직접 눌러 주세요');
    expect(hostOf('https://shop.example.com/login?x=1')).toBe('shop.example.com');
    expect(liveKeyFor('Enter')).toBe('Enter');
    expect(liveKeyFor('a')).toBeNull();
    expect(forgetSiteMessage({ title: '회사 관리 툴', detail: 'tank.betalab.kr · 근태·결재' })).toBe('tank.betalab.kr 사이트(회사 관리 툴)는 이제 잊어 줘');
    expect(forgetSiteMessage({ title: 'tank.betalab.kr', detail: '회사 관리 툴' })).toBe('tank.betalab.kr 사이트(tank.betalab.kr)는 이제 잊어 줘');
  });

  it('shows the open button from the live field first, the sentence only without it', () => {
    expect(handsOver({ text: '로그인이 필요해서 멈췄어요.', live: { view: 'browser-live' } })).toBe(true);
    expect(handsOver({ text: '앱의 브라우저 화면에서 직접 하실 수 있어요.', live: { view: 'other' } })).toBe(false);
    expect(handsOver({ text: '앱의 브라우저 화면에서 직접 하실 수 있어요.' })).toBe(true);
    expect(handsOver({ text: '그냥 답' })).toBe(false);
  });

  it('goes back where the errand came from after done', () => {
    expect(afterDone({ resumed: true, continuedIn: 'app', channel: 'team-dev' })).toEqual({ room: 'team-dev', say: '다 했다고 전했어요. 비서가 이어서 해요.' });
    expect(afterDone({ resumed: true, continuedIn: 'app' }).room).toBe('');
    expect(afterDone({ resumed: true, continuedIn: 'elsewhere' })).toEqual({ room: '', say: '브라우저 화면에서 마친 일은 디스코드 대화에서 이어 갈게요.' });
    expect(afterDone({ resumed: false }).say).toBe('브라우저 화면을 닫았어요.');
  });
});
