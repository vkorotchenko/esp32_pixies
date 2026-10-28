import {
  isSchedule,
  ScheduleZone,
  UTC_END,
  UTC_START,
  defaultSchedule,
} from './schedule';

export function phoneTimezone(
  utcSeconds = Math.floor(Date.now() / 1000),
  timezoneId?: string,
): ScheduleZone {
  try {
    const { Temporal } =
      require('@js-temporal/polyfill') as typeof import('@js-temporal/polyfill');
    const id = timezoneId ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!id || !/^[A-Za-z][A-Za-z0-9._+-]*(\/[A-Za-z0-9._+-]+)*$/.test(id)) {
      throw new Error('A named phone timezone is required.');
    }
    const fromUtc = utcSeconds - 3 * 86400;
    let cursor = Temporal.Instant.fromEpochMilliseconds(
      fromUtc * 1000,
    ).toZonedDateTimeISO(id);
    const untilUtc = Math.floor(
      Temporal.Instant.fromEpochMilliseconds(utcSeconds * 1000)
        .toZonedDateTimeISO(id)
        .add({ years: 2 }).epochMilliseconds / 1000,
    );
    if (fromUtc < UTC_START || untilUtc > UTC_END) {
      throw new Error(
        'Phone clock must allow two years of rules within 2020–2037.',
      );
    }
    const zone: ScheduleZone = {
      id,
      fromUtc,
      untilUtc,
      initialOffsetSeconds: cursor.offsetNanoseconds / 1e9,
      transitions: [],
    };
    for (;;) {
      const next = cursor.getTimeZoneTransition('next');
      if (!next || next.epochMilliseconds / 1000 >= untilUtc) {
        break;
      }
      if (
        zone.transitions.length === 16 ||
        next.epochMilliseconds <= cursor.epochMilliseconds
      ) {
        throw new Error('Timezone rules exceed the controller limit.');
      }
      zone.transitions.push({
        atUtc: next.epochMilliseconds / 1000,
        offsetSeconds: next.offsetNanoseconds / 1e9,
      });
      cursor = next;
    }
    if (!isSchedule({ ...defaultSchedule(), timezone: zone })) {
      throw new Error('Timezone rules are not supported.');
    }
    return zone;
  } catch (error) {
    throw new Error(
      `Timezone setup unavailable: ${
        error instanceof Error
          ? error.message
          : 'Intl timezone data is unavailable'
      }. Lights remain available.`,
    );
  }
}
