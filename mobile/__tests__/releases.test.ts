import { compareVersion, latestRelease, manifest, releaseUrl, versionParts } from '../src/releases';
import { releaseFixture } from '../testFixtures/releases';

test('versions are canonical and compared numerically', () => {
  expect(compareVersion('0.10.0', '0.9.99')).toBe(1);
  expect(compareVersion('1.0.0', '1.0.0')).toBe(0);
  for (const value of ['1.2.3.4', '01.2.3', '1.2.3\n', '1.2.3-beta.1', '1.2', '1000000.0.0']) {
    expect(() => versionParts(value)).toThrow();
  }
});
test('accepts only coherent target, version, package, bounded size and fixed release URLs', () => {
  const valid = releaseFixture();
  expect(manifest(valid, valid.version)).toEqual(valid);
  for (const patch of [
    { version: '0.3.2' }, { localDirtyBuild: true }, { commit: 'x' },
    { firmware: { ...valid.firmware, target: 'esp32' } },
    { firmware: { ...valid.firmware, bleOtaProtocol: 2 } },
    { firmware: { ...valid.firmware, size: 0x700001 } },
    { firmware: { ...valid.firmware, sha256: 'a'.repeat(64) + '\n' } },
    { firmware: { ...valid.firmware, url: 'https://attacker.invalid/firmware.bin' } },
    { android: { ...valid.android, packageName: 'other.app' } },
    { android: { ...valid.android, versionCode: 1.5 } },
    { android: { ...valid.android, size: 151 * 1024 * 1024 } },
  ]) {
    expect(() => manifest({ ...valid, ...patch }, valid.version)).toThrow();
  }
});
test('discovery rejects draft/missing/mismatched assets and handles rate limits explicitly', async () => {
  const release = releaseFixture();
  const metadata = { draft: false, prerelease: false, tag_name: 'v0.3.1',
    assets: [{ name: 'release.json', size: 1500, browser_download_url: releaseUrl('0.3.1', 'release.json') },
      ...[release.firmware, release.android].map(a => ({ name: a.name, size: a.size, browser_download_url: a.url }))] };
  const response = (body: unknown) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) });
  globalThis.fetch = jest.fn().mockResolvedValueOnce(response(metadata)).mockResolvedValueOnce(response(release));
  await expect(latestRelease(new AbortController().signal)).resolves.toEqual(release);
  globalThis.fetch = jest.fn().mockResolvedValue(response({ ...metadata, draft: true }));
  await expect(latestRelease(new AbortController().signal)).rejects.toThrow('published stable');
  globalThis.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 });
  await expect(latestRelease(new AbortController().signal)).rejects.toThrow('rate limits');
  globalThis.fetch = jest.fn().mockResolvedValueOnce(response({ ...metadata, assets: metadata.assets.slice(0, 1) }))
    .mockResolvedValueOnce(response(release));
  await expect(latestRelease(new AbortController().signal)).rejects.toThrow('disagree');
});
