import { describe, expect, it } from 'vitest';
import { clockLabel, decodeDictation, insertDictation, meterOf, rmsDb, SILENT_DB } from './dictation';

describe('insertDictation', () => {
  it('goes at the end of an empty or finished box', () => {
    expect(insertDictation('', null, null, ' 내일 회의 잡아 줘 ')).toEqual({ value: '내일 회의 잡아 줘', caret: 10 });
    expect(insertDictation('메모:', 3, 3, '우유 사기')).toEqual({ value: '메모: 우유 사기', caret: 9 });
  });
  it('goes at the caret, replacing a selection, with spaces around words', () => {
    expect(insertDictation('내일회의', 2, 2, '오후')).toEqual({ value: '내일 오후 회의', caret: 5 });
    expect(insertDictation('내일 XX 회의', 3, 5, '오후 3시')).toEqual({ value: '내일 오후 3시 회의', caret: 8 });
  });
  it('changes nothing when nothing was heard', () => {
    expect(insertDictation('그대로', 1, 1, '  ')).toEqual({ value: '그대로', caret: 1 });
  });
});

describe('dictation words', () => {
  it('reads the answer and shows time as m:ss', () => {
    expect(decodeDictation({ ok: true, text: ' 안녕 ' })).toEqual({ text: '안녕', message: undefined });
    expect(decodeDictation({ text: '', message: '말소리를 못 찾았어요.' })).toEqual({ text: '', message: '말소리를 못 찾았어요.' });
    expect(decodeDictation(null)).toEqual({ text: '', message: undefined });
    expect(clockLabel(7.9)).toBe('0:07');
    expect(clockLabel(102)).toBe('1:42');
  });
});

describe('sound level', () => {
  it('tells silence from speech', () => {
    expect(rmsDb(new Uint8Array(256).fill(128))).toBe(-Infinity);
    expect(rmsDb(new Uint8Array(256).fill(128).map((_, i) => (i % 2 ? 129 : 127)))).toBeLessThan(SILENT_DB + 15);
    const loud = new Uint8Array(256).map((_, i) => 128 + Math.round(40 * Math.sin(i / 4)));
    expect(rmsDb(loud)).toBeGreaterThan(-15);
    expect(meterOf(-Infinity)).toBe(0);
    expect(meterOf(-60)).toBe(0);
    expect(meterOf(-30)).toBe(0.5);
    expect(meterOf(3)).toBe(1);
  });
});
