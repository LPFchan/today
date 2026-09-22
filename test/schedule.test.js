import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScheduleError, absoluteItems, dayState, parseSchedule, serializeSchedule } from '../public/schedule.js';

const code = (fn) => {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ScheduleError);
    return [error.code, error.line];
  }
  assert.fail('expected a ScheduleError');
};

test('ranges, open ends and notes', () => {
  const items = parseSchedule('# morning\n09:00-10:30 Deep work\n10:30 Email\n12:00 Lunch\n');
  assert.deepEqual(items, [
    { start: 540, end: 630, name: 'Deep work' },
    { start: 630, end: 720, name: 'Email' },
    { start: 720, end: 780, name: 'Lunch' },
  ]);
  assert.equal(serializeSchedule(items), '09:00-10:30 Deep work\n10:30-12:00 Email\n12:00-13:00 Lunch');
});

test('Korean separators and names', () => {
  assert.deepEqual(parseSchedule('9:00부터10:00 디자인 리뷰\n10:00~11:00 점심'), [
    { start: 540, end: 600, name: '디자인 리뷰' },
    { start: 600, end: 660, name: '점심' },
  ]);
});

test('a night that runs past midnight rolls over', () => {
  assert.deepEqual(parseSchedule('23:00 Write\n01:00-02:00 Sleep soon'), [
    { start: 1380, end: 1500, name: 'Write' },
    { start: 1500, end: 1560, name: 'Sleep soon' },
  ]);
  assert.deepEqual(parseSchedule('23:30-00:30 Late'), [{ start: 1410, end: 1470, name: 'Late' }]);
});

test('errors carry a code and a line', () => {
  assert.deepEqual(code(() => parseSchedule('25:00 Nope')), ['badTime', 1]);
  assert.deepEqual(code(() => parseSchedule('09:00-10:00 A\nhello')), ['unreadable', 2]);
  assert.deepEqual(code(() => parseSchedule('10:00 A\n09:00 B')), ['backwards', 2]);
  assert.deepEqual(code(() => parseSchedule('09:00-11:00 A\n10:00 B')), ['overlap', 2]);
  assert.deepEqual(code(() => parseSchedule(`09:00 ${'x'.repeat(81)}`)), ['nameTooLong', 1]);
  const many = Array.from({ length: 61 }, (_, i) => `${String(Math.floor(i / 4) + 6).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')} x`);
  assert.deepEqual(code(() => parseSchedule(many.join('\n'))), ['tooLong', 0]);
});

test('day state walks through a day', () => {
  const items = absoluteItems(parseSchedule('09:00-10:00 A\n11:00-12:00 B'), 0);
  const at = (h, m = 0) => (h * 60 + m) * 60_000;
  assert.deepEqual(dayState(items, at(8)), { kind: 'waiting', index: 0, completed: 0 });
  assert.deepEqual(dayState(items, at(9, 30)), { kind: 'active', index: 0, completed: 0 });
  assert.deepEqual(dayState(items, at(10, 30)), { kind: 'break', index: 1, completed: 1 });
  assert.deepEqual(dayState(items, at(12)), { kind: 'finished', index: -1, completed: 2 });
  assert.deepEqual(dayState([], at(12)), { kind: 'empty', index: -1, completed: 0 });
});
