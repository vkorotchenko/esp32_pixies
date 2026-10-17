import { record } from './model';

export const REPOSITORY = 'vkorotchenko/esp32_pixies';
export const RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
export class NoPublishedRelease extends Error {
  constructor() {
    super('No published release is available yet.');
  }
}
export interface Asset {
  name: string;
  size: number;
  sha256: string;
  url: string;
}
export interface Release {
  schemaVersion: 1;
  version: string;
  commit: string;
  firmware: Asset & { target: string; bleOtaProtocol: number };
  android: Asset & {
    packageName: string;
    versionCode: number;
    certificateSha256: string;
  };
}
export function isVersion(value: string): boolean {
  const match = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.exec(
    value,
  );
  return match?.[0] === value;
}
export function versionParts(value: string): number[] {
  if (!isVersion(value)) {
    throw new Error('Expected a stable major.minor.patch version.');
  }
  return value.split('.').map(Number);
}
export function compareVersion(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] > b[i] ? 1 : -1;
    }
  }
  return 0;
}
export function releaseUrl(version: string, name: string): string {
  versionParts(version);
  return `https://github.com/${REPOSITORY}/releases/download/v${version}/${name}`;
}
function asset(
  value: unknown,
  version: string,
  name: string,
  min: number,
  max: number,
): asserts value is Asset {
  if (
    !record(value) ||
    value.name !== name ||
    value.url !== releaseUrl(version, name) ||
    !Number.isInteger(value.size) ||
    Number(value.size) < min ||
    Number(value.size) > max ||
    typeof value.sha256 !== 'string' ||
    value.sha256.length !== 64 ||
    !/^[a-f0-9]{64}$/.test(value.sha256)
  ) {
    throw new Error(`Invalid or incompatible release asset: ${name}`);
  }
}
export function manifest(value: unknown, expectedVersion: string): Release {
  versionParts(expectedVersion);
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    value.version !== expectedVersion ||
    value.localDirtyBuild !== undefined ||
    typeof value.commit !== 'string' ||
    value.commit.length !== 40 ||
    !/^[a-f0-9]{40}$/.test(value.commit)
  ) {
    throw new Error('Invalid release manifest/version/source.');
  }
  asset(value.firmware, expectedVersion, 'pixies-firmware.bin', 288, 0x700000);
  asset(
    value.android,
    expectedVersion,
    'pixies-android.apk',
    1024,
    150 * 1024 * 1024,
  );
  const firmware = value.firmware;
  const android = value.android;
  if (
    !record(firmware) ||
    firmware.target !== 'esp32s3_n16r8' ||
    firmware.bleOtaProtocol !== 1 ||
    !record(android) ||
    android.packageName !== 'com.pixies.controller' ||
    !Number.isInteger(android.versionCode) ||
    Number(android.versionCode) < 1 ||
    Number(android.versionCode) > 2100000000 ||
    typeof android.certificateSha256 !== 'string' ||
    android.certificateSha256.length !== 64 ||
    !/^[a-f0-9]{64}$/.test(android.certificateSha256)
  ) {
    throw new Error(
      'Unsupported firmware target/protocol or Android identity.',
    );
  }
  return {
    schemaVersion: 1,
    version: expectedVersion,
    commit: value.commit,
    firmware: { ...firmware, target: 'esp32s3_n16r8', bleOtaProtocol: 1 },
    android: {
      ...android,
      packageName: 'com.pixies.controller',
      versionCode: Number(android.versionCode),
      certificateSha256: android.certificateSha256,
    },
  };
}
async function json(
  url: string,
  signal: AbortSignal,
  max: number,
): Promise<unknown> {
  const request = new AbortController();
  const cancel = () => request.abort();
  signal.addEventListener('abort', cancel);
  if (signal.aborted) {
    request.abort();
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    request.abort();
  }, 30000);
  try {
    const response = await fetch(url, {
      signal: request.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) {
      if (response.status === 404 && url === RELEASE_API) {
        throw new NoPublishedRelease();
      }
      throw new Error(
        `Release request failed (HTTP ${response.status}). Check Internet access or GitHub rate limits.`,
      );
    }
    const declared = response.headers.get('content-length');
    if (declared && Number(declared) > max) {
      throw new Error('Release response is too large.');
    }
    const text = await response.text();
    if (text.length > max) {
      throw new Error('Release response is too large.');
    }
    return JSON.parse(text);
  } catch (error) {
    if (timedOut) {
      throw new Error('Release request timed out. Check Internet access.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}
export async function latestRelease(signal: AbortSignal): Promise<Release> {
  const metadata = await json(RELEASE_API, signal, 65536);
  if (
    !record(metadata) ||
    metadata.draft !== false ||
    metadata.prerelease !== false ||
    typeof metadata.tag_name !== 'string' ||
    !metadata.tag_name.startsWith('v') ||
    !Array.isArray(metadata.assets) ||
    metadata.assets.length > 20
  ) {
    throw new Error('Expected a published stable GitHub Release.');
  }
  const version = metadata.tag_name.slice(1);
  versionParts(version);
  const assets = metadata.assets;
  const descriptor = assets.filter(a => record(a) && a.name === 'release.json');
  if (
    descriptor.length !== 1 ||
    !record(descriptor[0]) ||
    descriptor[0].browser_download_url !==
      releaseUrl(version, 'release.json') ||
    !Number.isInteger(descriptor[0].size) ||
    Number(descriptor[0].size) < 1 ||
    Number(descriptor[0].size) > 16384
  ) {
    throw new Error(
      'Release is missing a bounded, correctly located manifest.',
    );
  }
  const release = manifest(
    await json(releaseUrl(version, 'release.json'), signal, 16384),
    version,
  );
  for (const item of [release.firmware, release.android]) {
    const matches = assets.filter(a => record(a) && a.name === item.name);
    if (
      matches.length !== 1 ||
      !record(matches[0]) ||
      matches[0].size !== item.size ||
      matches[0].browser_download_url !== item.url
    ) {
      throw new Error(
        'Release assets and manifest disagree. Do not install this release.',
      );
    }
  }
  return release;
}
