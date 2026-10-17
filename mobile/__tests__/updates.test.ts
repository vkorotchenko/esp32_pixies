import { Buffer } from 'buffer';
import { FileSystem } from 'react-native-file-access';
import { DeviceError, PixiesClient } from '../src/client';
import { download, firmwareProblem, updateFirmware } from '../src/updates';
import { healthFixture, releaseFixture } from '../testFixtures/releases';

jest.mock('react-native-file-access', () => ({
  Dirs: { CacheDir: '/cache' },
  FileSystem: { mkdir: jest.fn(), exists: jest.fn(), unlink: jest.fn(), hash: jest.fn(),
    stat: jest.fn(), readFileChunk: jest.fn(), fetchManaged: jest.fn() },
}));
const id = '0123456789abcdef';
const release = releaseFixture();
const updated = { ...healthFixture(), bootId: 'new-boot', firmware: { version: '0.3.1', target: 'esp32s3_n16r8' } };
function client() {
  const value = new PixiesClient({ mtu: 247, write: async () => {}, subscribe: () => () => {} });
  const command = jest.spyOn(value, 'command').mockImplementation(async (op, args) => {
    if (op === 'status') { return healthFixture(); }
    if (op === 'ota.begin') { return { transferId: id, offset: 0, chunkBytes: 512 }; }
    if (op === 'ota.chunk') { return { transferId: id, offset: Number(args?.offset) + 512 }; }
    if (op === 'ota.abort') { return { state: 'aborted' }; }
    return { state: 'restarting', version: release.version, receivedBytes: release.firmware.size };
  });
  return { value, command };
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(FileSystem.exists).mockResolvedValue(true);
  jest.mocked(FileSystem.readFileChunk).mockResolvedValue(Buffer.alloc(512).toString('base64'));
  jest.mocked(FileSystem.stat).mockResolvedValue({ size: 1024, filename: 'firmware', path: '/cache/file', type: 'file', lastModified: 0 });
  jest.mocked(FileSystem.hash).mockResolvedValue(release.firmware.sha256);
  jest.mocked(FileSystem.fetchManaged).mockReturnValue({
    result: Promise.resolve({ ok: true, status: 200, statusText: 'OK', headers: {}, getHeader: () => undefined, redirected: false, url: release.firmware.url }),
    cancel: jest.fn().mockResolvedValue(undefined),
  });
});
test('streaming success requires exact acknowledgements and a new boot with the release version', async () => {
  const f = client(); const reconnect = jest.fn().mockResolvedValue(updated); const progress = jest.fn();
  await updateFirmware(f.value, release, '/cache/fw', new AbortController().signal, progress, reconnect);
  expect(f.command.mock.calls.filter(([op]) => op === 'ota.chunk')).toHaveLength(2);
  expect(reconnect).toHaveBeenCalledWith('old-boot', '0.3.1', expect.anything());
  expect(progress).toHaveBeenLastCalledWith('Firmware 0.3.1 verified');
});
test('wrong chunk offset aborts rather than replaying or reporting success', async () => {
  const f = client();
  const original = f.command.getMockImplementation()!;
  f.command.mockImplementation(async (op, args) => op === 'ota.chunk' ? { transferId: id, offset: 0 } : original(op, args));
  const reconnect = jest.fn();
  await expect(updateFirmware(f.value, release, '/cache/fw', new AbortController().signal, jest.fn(), reconnect)).rejects.toThrow('expected offset');
  expect(f.command).toHaveBeenCalledWith('ota.abort', { transferId: id });
  expect(reconnect).not.toHaveBeenCalled();
});
test('a lost final reply is only successful after authoritative boot/version confirmation', async () => {
  const f = client(); const original = f.command.getMockImplementation()!;
  f.command.mockImplementation(async (op, args) => {
    if (op === 'ota.finish') { throw new Error('Disconnected'); }
    return original(op, args);
  });
  await expect(updateFirmware(f.value, release, '/cache/fw', new AbortController().signal, jest.fn(), async () => updated)).resolves.toBeUndefined();
  await expect(updateFirmware(f.value, release, '/cache/fw', new AbortController().signal, jest.fn(), async () => healthFixture())).rejects.toThrow('NOT verified');
  expect(f.command.mock.calls.filter(([op]) => op === 'ota.abort')).toHaveLength(0);
});
test('an explicit firmware rejection cannot turn into optimistic reconnect success', async () => {
  const f = client(); const original = f.command.getMockImplementation()!;
  f.command.mockImplementation(async (op, args) => {
    if (op === 'ota.finish') { throw new DeviceError('update_failed', 'checksum_mismatch'); }
    return original(op, args);
  });
  const reconnect = jest.fn().mockResolvedValue(updated);
  await expect(updateFirmware(f.value, release, '/cache/fw', new AbortController().signal, jest.fn(), reconnect)).rejects.toThrow('checksum_mismatch');
  expect(reconnect).not.toHaveBeenCalled();
});
test('cancellation between chunks requests an acknowledged abort and never finalizes', async () => {
  const f = client(); const abort = new AbortController(); const original = f.command.getMockImplementation()!;
  f.command.mockImplementation(async (op, args) => {
    const response = await original(op, args);
    if (op === 'ota.chunk') { abort.abort(); }
    return response;
  });
  await expect(updateFirmware(f.value, release, '/cache/fw', abort.signal, jest.fn(), jest.fn())).rejects.toThrow('canceled');
  expect(f.command).toHaveBeenCalledWith('ota.abort', { transferId: id });
  expect(f.command.mock.calls.some(([op]) => op === 'ota.finish')).toBe(false);
});
test('legacy firmware, wrong target and downgrade are blocked before OTA', () => {
  expect(firmwareProblem({ ...healthFixture(), update: { busy: false } }, release)).toContain('one-time');
  expect(firmwareProblem({ ...healthFixture(), firmware: { version: '0.3.2', target: 'esp32s3_n16r8' } }, release)).toContain('newer');
  expect(firmwareProblem({ ...healthFixture(), firmware: { version: '0.2.2', target: 'esp32' } }, release)).toContain('target');
});
test('download verifies both length and hash and cleans a rejected file', async () => {
  await expect(download(release.firmware, new AbortController().signal, jest.fn())).resolves.toContain('pixies-updates');
  jest.mocked(FileSystem.hash).mockResolvedValue('0'.repeat(64));
  await expect(download(release.firmware, new AbortController().signal, jest.fn())).rejects.toThrow('checksum');
  expect(FileSystem.unlink).toHaveBeenCalled();
  jest.mocked(FileSystem.stat).mockResolvedValue({ size: 1023, filename: '', path: '', type: 'file', lastModified: 0 });
  await expect(download(release.firmware, new AbortController().signal, jest.fn())).rejects.toThrow('length');
});
test.each(['cancel', 'oversize', 'timeout'])('interrupted download (%s) cancels native work and removes partial data', async kind => {
  jest.useFakeTimers();
  const cancel = jest.fn().mockResolvedValue(undefined);
  let report: Parameters<typeof FileSystem.fetchManaged>[2];
  jest.mocked(FileSystem.fetchManaged).mockImplementation((_url, _options, progress) => {
    report = progress;
    return { result: new Promise(() => {}), cancel };
  });
  const abort = new AbortController();
  const result = download(release.firmware, abort.signal, jest.fn());
  const assertion = (async () => {
    await expect(result).rejects.toThrow(kind === 'oversize' ? 'exceeded' : kind === 'timeout' ? 'timed out' : 'canceled');
  })();
  try {
    for (let i = 0; i < 8; i++) { await Promise.resolve(); }
    if (kind === 'cancel') { abort.abort(); }
    else if (kind === 'oversize') { report!(release.firmware.size + 1, release.firmware.size, false); }
    else { jest.advanceTimersByTime(300000); }
    await assertion;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(FileSystem.unlink).toHaveBeenCalledTimes(2);
  } finally { jest.useRealTimers(); }
});
test('failed native cancellation still attempts cache cleanup and preserves the original error', async () => {
  const abort = new AbortController();
  jest.mocked(FileSystem.fetchManaged).mockImplementation((_url, _options, progress) => {
    progress!(1025, 1024, false);
    return { result: new Promise(() => {}), cancel: jest.fn().mockRejectedValue(new Error('native failure')) };
  });
  await expect(download(release.firmware, abort.signal, jest.fn())).rejects.toThrow('exceeded the declared release size. Cleanup failed (cancel: native failure)');
  expect(FileSystem.unlink).toHaveBeenCalledTimes(2);
});
