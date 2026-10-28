export const UTC_START = 1577836800;
export const UTC_END = 2145916800;
export const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;
export interface ScheduleZone {
  id: string;
  fromUtc: number;
  untilUtc: number;
  initialOffsetSeconds: number;
  transitions: { atUtc: number; offsetSeconds: number }[];
}
export interface ScheduleDay {
  enabled: boolean;
  onMinute: number;
  offMinute: number;
}
export interface ScheduleV1 {
  version: 1;
  enabled: boolean;
  timezone: ScheduleZone | null;
  days: ScheduleDay[];
}
export interface ScheduleRuntime {
  enabled: boolean;
  healthy: boolean;
  recovery: string;
  effectiveOn: boolean;
  automaticOn: boolean;
  overrideActive: boolean;
  overrideOn: boolean;
  overrideUntilUtc: number | null;
  nextBoundaryUtc: number | null;
  pauseReason: string;
  timezoneId: string | null;
  ruleExpiryUtc: number | null;
  clock: {
    synced: boolean;
    utcSeconds: number | null;
    syncAgeSeconds: number | null;
    source: string;
  };
}
export interface ScheduleResponse {
  bootId: string;
  revision: number;
  schedule: ScheduleV1;
  runtime: ScheduleRuntime;
}
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const keys = (v: Record<string, unknown>, expected: string) =>
  Object.keys(v).sort().join(',') === expected;
const utcOrNull = (v: unknown) => v === null || integer(v, UTC_START, UTC_END);
export function isSchedule(v: unknown): v is ScheduleV1 {
  if (
    !object(v) ||
    !keys(v, 'days,enabled,timezone,version') ||
    v.version !== 1 ||
    typeof v.enabled !== 'boolean' ||
    !Array.isArray(v.days) ||
    v.days.length !== 7 ||
    !v.days.every(
      d =>
        object(d) &&
        keys(d, 'enabled,offMinute,onMinute') &&
        typeof d.enabled === 'boolean' &&
        integer(d.onMinute, 0, 1439) &&
        integer(d.offMinute, 0, 1439) &&
        (!d.enabled || d.onMinute !== d.offMinute),
    )
  ) {
    return false;
  }
  if (v.timezone === null) {
    return !v.enabled;
  }
  const z = v.timezone;
  if (
    !object(z) ||
    !keys(z, 'fromUtc,id,initialOffsetSeconds,transitions,untilUtc') ||
    typeof z.id !== 'string' ||
    !/^[\x21-\x7e]{1,64}$/.test(z.id) ||
    !integer(z.fromUtc, UTC_START, UTC_END - 1) ||
    !integer(z.untilUtc, z.fromUtc + 1, UTC_END) ||
    !integer(z.initialOffsetSeconds, -50400, 50400) ||
    !Array.isArray(z.transitions) ||
    z.transitions.length > 16
  ) {
    return false;
  }
  let previous = z.fromUtc;
  for (const t of z.transitions) {
    if (
      !object(t) ||
      !keys(t, 'atUtc,offsetSeconds') ||
      !integer(t.atUtc, previous + 1, z.untilUtc - 1) ||
      !integer(t.offsetSeconds, -50400, 50400)
    ) {
      return false;
    }
    previous = t.atUtc;
  }
  return true;
}
export function scheduleRuntime(v: unknown): ScheduleRuntime | null {
  if (
    !object(v) ||
    ![
      'enabled',
      'healthy',
      'effectiveOn',
      'automaticOn',
      'overrideActive',
      'overrideOn',
    ].every(k => typeof v[k] === 'boolean') ||
    typeof v.recovery !== 'string' ||
    typeof v.pauseReason !== 'string' ||
    !(v.timezoneId === null || typeof v.timezoneId === 'string') ||
    !utcOrNull(v.overrideUntilUtc) ||
    !utcOrNull(v.nextBoundaryUtc) ||
    !utcOrNull(v.ruleExpiryUtc) ||
    !object(v.clock) ||
    typeof v.clock.synced !== 'boolean' ||
    typeof v.clock.source !== 'string' ||
    !utcOrNull(v.clock.utcSeconds) ||
    !(
      v.clock.syncAgeSeconds === null ||
      integer(v.clock.syncAgeSeconds, 0, Number.MAX_SAFE_INTEGER)
    ) ||
    (v.clock.synced
      ? v.clock.utcSeconds === null || v.clock.syncAgeSeconds === null
      : v.clock.utcSeconds !== null || v.clock.syncAgeSeconds !== null)
  ) {
    return null;
  }
  return v as unknown as ScheduleRuntime;
}
export function scheduleResponse(v: unknown): ScheduleResponse {
  if (
    !object(v) ||
    !keys(v, 'bootId,revision,runtime,schedule') ||
    typeof v.bootId !== 'string' ||
    !/^[0-9a-f]{16}$/.test(v.bootId) ||
    !integer(v.revision, 1, 0xffffffff) ||
    !isSchedule(v.schedule) ||
    !scheduleRuntime(v.runtime)
  ) {
    throw new Error(
      'Invalid scheduling response. Reload Schedule; lights are still available.',
    );
  }
  return v as unknown as ScheduleResponse;
}
export function defaultSchedule(): ScheduleV1 {
  return {
    version: 1,
    enabled: false,
    timezone: null,
    days: WEEKDAYS.map(() => ({
      enabled: false,
      onMinute: 1080,
      offMinute: 1380,
    })),
  };
}
export function sameSchedule(a: ScheduleV1, b: ScheduleV1): boolean {
  const az = a.timezone,
    bz = b.timezone;
  const zoneEqual =
    az === null || bz === null
      ? az === bz
      : az.id === bz.id &&
        az.fromUtc === bz.fromUtc &&
        az.untilUtc === bz.untilUtc &&
        az.initialOffsetSeconds === bz.initialOffsetSeconds &&
        az.transitions.length === bz.transitions.length &&
        az.transitions.every(
          (t, i) =>
            t.atUtc === bz.transitions[i].atUtc &&
            t.offsetSeconds === bz.transitions[i].offsetSeconds,
        );
  return (
    a.version === b.version &&
    a.enabled === b.enabled &&
    zoneEqual &&
    a.days.length === b.days.length &&
    a.days.every(
      (d, i) =>
        d.enabled === b.days[i].enabled &&
        d.onMinute === b.days[i].onMinute &&
        d.offMinute === b.days[i].offMinute,
    )
  );
}
export const minuteText = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(
    minute % 60,
  ).padStart(2, '0')}`;
export function utcText(utc: number | null): string {
  return utc === null
    ? 'Unavailable'
    : new Date(utc * 1000)
        .toISOString()
        .replace('T', ' ')
        .replace('.000Z', ' UTC');
}
