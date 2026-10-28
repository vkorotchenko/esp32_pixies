import { defaultSchedule, ScheduleResponse } from '../src/schedule';
export function scheduleFixture(): ScheduleResponse {
  return {
    bootId: '0123456789abcdef',
    revision: 1,
    schedule: {
      ...defaultSchedule(),
      timezone: {
        id: 'Etc/UTC',
        fromUtc: 1792713600,
        untilUtc: 1856131200,
        initialOffsetSeconds: 0,
        transitions: [],
      },
    },
    runtime: {
      enabled: false,
      healthy: true,
      recovery: 'none',
      effectiveOn: true,
      automaticOn: false,
      overrideActive: false,
      overrideOn: false,
      overrideUntilUtc: null,
      nextBoundaryUtc: null,
      pauseReason: 'none',
      timezoneId: 'Etc/UTC',
      ruleExpiryUtc: 1856131200,
      clock: {
        synced: true,
        utcSeconds: 1792972800,
        syncAgeSeconds: 0,
        source: 'phone',
      },
    },
  };
}
