import { Buffer } from 'buffer';

export const EFFECTS = [
  'steady',
  'twinkle',
  'candle',
  'breathe',
  'chase',
] as const;
export const BUILTINS = ['builtin:light-blue', 'halloween', 'christmas'];
export type Effect = (typeof EFFECTS)[number];
export interface Palette {
  id: string;
  name: string;
  colors: string[];
}
export interface Config {
  ledCount: number;
  on: boolean;
  brightness: number;
  speed: number;
  intensity: number;
  density: number;
  effect: Effect;
  paletteId: string;
  customPalettes: Palette[];
}
export interface Snapshot {
  schemaVersion: number;
  bootId: string;
  revision: number;
  savedRevision: number;
  dirty: boolean;
  activeLedCount: number;
  requestedLedCount: number;
  savedLedCount: number;
  restartRequired: boolean;
  savedRestartRequired: boolean;
  config: Config;
}
export interface Status {
  bootId: string;
  firmware: { version: string; target: string };
  led: {
    ready: boolean;
    gpio: number;
    frames: number;
    estimatedMa: number;
    limited: boolean;
  };
  network: {
    state: string;
    hostname: string;
    connected: boolean;
    ip: string;
    ssid: string;
    candidateState: string;
    error: string;
    wifiSaved: boolean;
  };
  admin: { configured: boolean };
  update: { busy: boolean; bleOtaProtocol?: number };
  power?: PowerStatus;
}
export interface PowerConfig {
  supplyWatts: number;
  ledMilliWatts: number;
}
export interface PowerStatus extends PowerConfig {
  revision: number;
  headroomPercent: number;
  volts: number;
  maximumMa: number;
  budgetMa: number;
  ready: boolean;
  recovery: 'none' | 'missing' | 'invalid_record' | 'storage_unavailable';
}
export interface WifiNetwork {
  ssid: string;
  rssi: number;
  open: boolean;
}
export interface WifiScan {
  state: string;
  networks: WifiNetwork[];
}
export const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
export function isPowerStatus(v: unknown): v is PowerStatus {
  if (
    !record(v) ||
    !integer(v.revision, 1, 0xffffffff) ||
    !integer(v.supplyWatts, 1, 2000) ||
    !integer(v.ledMilliWatts, 10, 10000) ||
    !integer(v.headroomPercent, 1, 99) ||
    v.volts !== 5 ||
    !integer(v.maximumMa, 1000, 9000) ||
    !integer(v.budgetMa, 0, 9000) ||
    typeof v.ready !== 'boolean' ||
    typeof v.recovery !== 'string' ||
    !['none', 'missing', 'invalid_record', 'storage_unavailable'].includes(
      v.recovery,
    )
  )
    return false;
  const expected = Math.min(
    v.maximumMa,
    Math.floor(
      (v.supplyWatts * 1000 * (100 - v.headroomPercent)) / (100 * v.volts),
    ),
  );
  return (
    v.budgetMa === (v.ready ? expected : 0) &&
    v.ready === ['none', 'missing'].includes(v.recovery)
  );
}
export function isConfig(v: unknown): v is Config {
  if (
    !record(v) ||
    Object.keys(v).sort().join(',') !==
      'brightness,customPalettes,density,effect,intensity,ledCount,on,paletteId,speed'
  ) {
    return false;
  }
  if (
    !integer(v.ledCount, 1, 1000) ||
    typeof v.on !== 'boolean' ||
    !['brightness', 'speed', 'intensity', 'density'].every(k =>
      integer(v[k], 0, 100),
    ) ||
    !EFFECTS.some(e => e === v.effect) ||
    typeof v.paletteId !== 'string' ||
    !Array.isArray(v.customPalettes) ||
    v.customPalettes.length > 10
  ) {
    return false;
  }
  const ids = new Set(BUILTINS);
  for (const p of v.customPalettes) {
    if (
      !record(p) ||
      Object.keys(p).sort().join(',') !== 'colors,id,name' ||
      typeof p.id !== 'string' ||
      !/^[a-z0-9_-]{1,24}$/.test(p.id) ||
      ids.has(p.id) ||
      typeof p.name !== 'string' ||
      !/^[\x20-\x7e]{1,32}$/.test(p.name) ||
      !Array.isArray(p.colors) ||
      p.colors.length < 1 ||
      p.colors.length > 8 ||
      !p.colors.every(c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))
    ) {
      return false;
    }
    ids.add(p.id);
  }
  return ids.has(v.paletteId);
}
function requireSnapshot(v: unknown): asserts v is Snapshot {
  if (
    !record(v) ||
    v.schemaVersion !== 1 ||
    typeof v.bootId !== 'string' ||
    !/^[0-9a-f]{16}$/.test(v.bootId) ||
    !integer(v.revision, 1, 0xffffffff) ||
    !integer(v.savedRevision, 1, 0xffffffff) ||
    !isConfig(v.config) ||
    !['activeLedCount', 'requestedLedCount', 'savedLedCount'].every(k =>
      integer(v[k], 1, 1000),
    ) ||
    !['dirty', 'restartRequired', 'savedRestartRequired'].every(
      k => typeof v[k] === 'boolean',
    )
  ) {
    throw new Error('Incomplete device configuration. Reconnect and reload.');
  }
}
export function snapshot(v: unknown): Snapshot {
  requireSnapshot(v);
  return v;
}
function requireStatus(v: unknown): asserts v is Status {
  if (
    !record(v) ||
    typeof v.bootId !== 'string' ||
    !record(v.firmware) ||
    typeof v.firmware.version !== 'string' ||
    typeof v.firmware.target !== 'string' ||
    !record(v.led) ||
    typeof v.led.ready !== 'boolean' ||
    typeof v.led.limited !== 'boolean' ||
    !['gpio', 'frames', 'estimatedMa'].every(k =>
      integer(v.led && record(v.led) ? v.led[k] : null, 0, 0xffffffff),
    ) ||
    !record(v.network) ||
    !['state', 'hostname', 'ip', 'ssid', 'candidateState', 'error'].every(
      k => record(v.network) && typeof v.network[k] === 'string',
    ) ||
    typeof v.network.connected !== 'boolean' ||
    typeof v.network.wifiSaved !== 'boolean' ||
    !record(v.admin) ||
    typeof v.admin.configured !== 'boolean' ||
    !record(v.update) ||
    typeof v.update.busy !== 'boolean' ||
    (v.power !== undefined && !isPowerStatus(v.power))
  ) {
    throw new Error('Incomplete device status. Reconnect and reload.');
  }
}
export function status(v: unknown): Status {
  requireStatus(v);
  return v;
}
function requireWifiScan(v: unknown): asserts v is WifiScan {
  if (
    !record(v) ||
    typeof v.state !== 'string' ||
    !Array.isArray(v.networks) ||
    v.networks.length > 20 ||
    !v.networks.every(
      n =>
        record(n) &&
        typeof n.ssid === 'string' &&
        integer(n.rssi, -127, 0) &&
        typeof n.open === 'boolean',
    )
  ) {
    throw new Error('Incomplete Wi-Fi scan response.');
  }
}
export function wifiScan(v: unknown): WifiScan {
  requireWifiScan(v);
  return v;
}
export function validateWifi(ssid: string, password: string): void {
  const size = Buffer.byteLength(ssid, 'utf8');
  const bytes = Buffer.byteLength(password, 'utf8');
  if (size < 1 || size > 32 || ssid.includes('\0')) {
    throw new Error('Network names must be 1–32 UTF-8 bytes.');
  }
  if (
    password.includes('\0') ||
    !(
      bytes === 0 ||
      (bytes >= 8 && bytes <= 63) ||
      /^[a-f0-9]{64}$/i.test(password)
    )
  ) {
    throw new Error(
      'Use an empty password for open Wi-Fi, 8–63 bytes, or a 64-digit hexadecimal key.',
    );
  }
}
