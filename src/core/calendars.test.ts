import { describe, expect, it } from 'vitest';
import { calendarColor, calendarName, decodeCalendars, eventCalendarLabel, eventColor, writableCalendars } from './calendars';

const cals = decodeCalendars([
  { id: 'team@group', name: '팀', primary: false, writable: true },
  { id: 'me@x', name: '내 캘린더', primary: true, writable: true, account: 'me@x' },
  { id: 'holidays', name: '공휴일', primary: false, writable: false },
  { id: '', name: '빈 id' },
  { id: 'x', name: '   ' },
  'junk',
]);

describe('calendars (§36)', () => {
  it('keeps only well-formed calendars', () => {
    expect(cals.map((c) => c.id)).toEqual(['team@group', 'me@x', 'holidays']);
    expect(decodeCalendars(undefined)).toEqual([]);
  });
  it('gives each id a stable color', () => {
    expect(calendarColor('team@group')).toBe(calendarColor('team@group'));
    expect(calendarColor('team@group')).toMatch(/^#[0-9A-F]{6}$/);
  });
  it('colors an event by its calendar name', () => {
    expect(eventColor({ calendar: '팀' }, cals)).toBe(calendarColor('team@group'));
    expect(eventColor({}, cals)).toBeUndefined();
    expect(eventColor({ calendar: '모르는 캘린더' }, cals)).toBe(eventColor({ calendar: '모르는 캘린더' }, []));
  });
  it('lists writable calendars with the primary first', () => {
    expect(writableCalendars(cals).map((c) => c.id)).toEqual(['me@x', 'team@group']);
    expect(writableCalendars([])).toEqual([]);
  });
  it('labels events and calendars', () => {
    expect(eventCalendarLabel({ calendar: '팀' })).toBe('팀');
    expect(eventCalendarLabel({ calendar: '팀', account: 'me@x' })).toBe('팀 · me@x');
    expect(eventCalendarLabel({})).toBe('');
    expect(calendarName(cals[1], cals)).toBe('내 캘린더');
    const two = decodeCalendars([{ id: 'a', name: '일', account: 'a@x' }, { id: 'b', name: '일', account: 'b@x' }]);
    expect(calendarName(two[0], two)).toBe('일 · a@x');
  });
});
