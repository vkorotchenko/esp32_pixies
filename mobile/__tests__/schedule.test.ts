import { isSchedule, scheduleResponse, sameSchedule } from '../src/schedule';
import { phoneTimezone } from '../src/phoneTimezone';
import { status } from '../src/model';
import { scheduleFixture } from '../testFixtures/schedule';
import { healthFixture } from '../testFixtures/releases';

test('requires complete seven-day objects without coercion or ignored fields', () => {
  const s = scheduleFixture().schedule;
  expect(isSchedule(s)).toBe(true);
  const reordered = {
    days: s.days.map(d => ({
      offMinute: d.offMinute,
      onMinute: d.onMinute,
      enabled: d.enabled,
    })),
    timezone: s.timezone,
    enabled: s.enabled,
    version: s.version,
  };
  expect(sameSchedule(s, reordered)).toBe(true);
  expect(isSchedule({ ...s, enabled: true, timezone: null })).toBe(false);
  expect(isSchedule({ ...s, days: s.days.slice(1) })).toBe(false);
  expect(isSchedule({ ...s, extra: true })).toBe(false);
  s.days[0] = { enabled: true, onMinute: 60, offMinute: 60 };
  expect(isSchedule(s)).toBe(false);
  s.days[0].offMinute = 120;
  expect(isSchedule(s)).toBe(true);
  expect(
    isSchedule({ ...s, timezone: { ...s.timezone, id: 'Bad\0Zone' } }),
  ).toBe(false);
  expect(
    isSchedule({
      ...s,
      days: [{ ...s.days[0], onMinute: '60' }, ...s.days.slice(1)],
    }),
  ).toBe(false);
});
test('invalid optional scheduling never rejects ordinary status or enables support by coercion', () => {
  const raw = {
    ...healthFixture(),
    capabilities: { weeklySchedule: 1 },
    scheduling: { clock: null },
  };
  expect(status(raw).capabilities?.weeklySchedule).toBe(1);
  expect(status(raw).scheduling).toBeUndefined();
  expect(
    status({ ...raw, capabilities: { weeklySchedule: '1' } }).capabilities,
  ).toBeUndefined();
  expect(() => scheduleResponse({ ...scheduleFixture(), runtime: {} })).toThrow(
    'scheduling response',
  );
});
test('exports real northern, southern, non-hour and fractional named-zone rules', () => {
  const now = 1792972800;
  const ny = phoneTimezone(now, 'America/New_York');
  expect(ny.fromUtc).toBe(now - 3 * 86400);
  expect(ny.transitions).toContainEqual({
    atUtc: 1793512800,
    offsetSeconds: -18000,
  });
  expect(ny.transitions.some(t => t.offsetSeconds === -14400)).toBe(true);
  const lordHowe = phoneTimezone(now, 'Australia/Lord_Howe');
  expect(lordHowe.transitions.map(t => t.offsetSeconds)).toEqual(
    expect.arrayContaining([37800, 39600]),
  );
  expect(phoneTimezone(now, 'Asia/Kathmandu').initialOffsetSeconds).toBe(20700);
  expect(
    phoneTimezone(now, 'America/St_Johns').transitions.some(
      t => t.offsetSeconds === -12600,
    ),
  ).toBe(true);
  expect(
    phoneTimezone(now, 'Pacific/Chatham').transitions.some(
      t => t.offsetSeconds === 45900,
    ),
  ).toBe(true);
});
test('timezone export fails closed rather than inventing fixed-offset rules', () => {
  expect(() => phoneTimezone(1792972800, '+05:30')).toThrow(
    'Timezone setup unavailable',
  );
  expect(() => phoneTimezone(1792972800, 'Not/A_Zone')).toThrow(
    'Lights remain available',
  );
  expect(() => phoneTimezone(2145910000, 'Etc/UTC')).toThrow('two years');
  const spy = jest
    .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
    .mockImplementation(() => {
      throw new Error('Intl unavailable');
    });
  try {
    expect(() => phoneTimezone(1792972800)).toThrow('Lights remain available');
  } finally {
    spy.mockRestore();
  }
});
