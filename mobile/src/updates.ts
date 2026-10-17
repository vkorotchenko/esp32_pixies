import { Buffer } from 'buffer';
import { Dirs, FileSystem } from 'react-native-file-access';
import { NativeModules, Platform } from 'react-native';
import { DeviceError, PixiesClient } from './client';
import { record, Status, status } from './model';
import { Asset, compareVersion, Release } from './releases';

export type Progress = (stage: string, percent?: number) => void;
export interface Installer {
  canInstall(): Promise<boolean>;
  openSettings(): Promise<void>;
  install(path: string, version: string, code: number, sha256: string): Promise<string>;
}
export function installer(): Installer {
  const module: Installer | undefined = NativeModules.PixiesInstaller;
  if (Platform.OS !== 'android' || !module ||
      typeof module.canInstall !== 'function' || typeof module.install !== 'function' ||
      typeof module.openSettings !== 'function') {
    throw new Error('APK installation is available only in a native Android build.');
  }
  return module;
}
export function checkCanceled(signal: AbortSignal) {
  if (signal.aborted) {
    throw new Error('Update canceled. Reconnect/read device state before retrying.');
  }
}
export function firmwareProblem(health: Status | null, release: Release): string | null {
  if (!health) {
    return 'Connect to the controller before updating its firmware.';
  }
  if (health.firmware.target !== release.firmware.target) {
    return 'This firmware does not match the connected controller target.';
  }
  if (health.update.bleOtaProtocol !== 1) {
    return 'This ESP needs a one-time USB/browser upgrade to firmware 0.3.0 or newer before BLE OTA is available.';
  }
  if (compareVersion(release.version, health.firmware.version) <= 0) {
    return 'The controller already runs this version or a newer version.';
  }
  if (health.update.busy) {
    return 'Another controller update is in progress.';
  }
  return null;
}
export async function removeDownload(path: string): Promise<void> {
  if (await FileSystem.exists(path)) {
    await FileSystem.unlink(path);
  }
}
export async function download(asset: Asset, signal: AbortSignal, progress: Progress): Promise<string> {
  checkCanceled(signal);
  const directory = `${Dirs.CacheDir}/pixies-updates`;
  await FileSystem.mkdir(directory);
  const path = `${directory}/pixies-${asset.sha256}${asset.name.endsWith('.apk') ? '.apk' : '.bin'}`;
  await removeDownload(path);
  let rejectDownload: (error: Error) => void = () => {};
  const interrupted = new Promise<never>((_, reject) => { rejectDownload = reject; });
  const transfer = FileSystem.fetchManaged(asset.url, { path }, bytes => {
    if (bytes > asset.size) {
      rejectDownload(new Error('Download exceeded the declared release size.'));
    }
    progress('Downloading', Math.min(100, Math.floor(bytes * 100 / asset.size)));
  });
  const cancel = () => rejectDownload(new Error('Download canceled.'));
  signal.addEventListener('abort', cancel);
  const timer = setTimeout(() => rejectDownload(new Error('Download timed out.')), 300000);
  let networkFinished = false;
  const fetching = transfer.result.then(result => {
    networkFinished = true; return result;
  }, (error: unknown) => { networkFinished = true; throw error; });
  try {
    checkCanceled(signal);
    const result = await Promise.race([fetching, interrupted]);
    checkCanceled(signal);
    if (!result.ok) {
      throw new Error(`Download failed (HTTP ${result.status}).`);
    }
    if ((await FileSystem.stat(path)).size !== asset.size) {
      throw new Error('Downloaded file length does not match the release.');
    }
    progress('Verifying download');
    if ((await FileSystem.hash(path, 'SHA-256')).toLowerCase() !== asset.sha256) {
      throw new Error('Downloaded file checksum does not match the release.');
    }
    checkCanceled(signal);
    return path;
  } catch (error) {
    const failures: string[] = [];
    if (!networkFinished) {
      try {
        await transfer.cancel();
      } catch (cancelError) {
        failures.push(`cancel: ${cancelError instanceof Error ? cancelError.message : 'native cancellation failed'}`);
      }
    }
    try {
      await removeDownload(path);
    } catch (cleanupError) {
      failures.push(`cache cleanup: ${cleanupError instanceof Error ? cleanupError.message : 'file removal failed'}`);
    }
    if (failures.length) {
      throw new Error(`${error instanceof Error ? error.message : 'Download failed.'} Cleanup failed (${failures.join('; ')}).`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}
export async function updateFirmware(
  client: PixiesClient, release: Release, path: string, signal: AbortSignal, progress: Progress,
  reconnect: (oldBootId: string, version: string, signal: AbortSignal) => Promise<Status>,
): Promise<void> {
  const health = status(await client.command('status'));
  const problem = firmwareProblem(health, release);
  if (problem) {
    throw new Error(problem);
  }
  let transferId: string | null = null;
  let finishing = false;
  try {
    checkCanceled(signal);
    const begin = await client.command('ota.begin', {
      size: release.firmware.size, sha256: release.firmware.sha256,
      target: release.firmware.target, version: release.version,
    });
    if (!record(begin) || typeof begin.transferId !== 'string' ||
        begin.transferId.length !== 16 || !/^[a-f0-9]{16}$/.test(begin.transferId) || begin.offset !== 0 ||
        !Number.isInteger(begin.chunkBytes) || Number(begin.chunkBytes) < 1 || Number(begin.chunkBytes) > 1024) {
      throw new Error('Malformed update-start acknowledgement. Reconnect before retrying.');
    }
    transferId = begin.transferId;
    const chunkBytes = Number(begin.chunkBytes);
    for (let offset = 0; offset < release.firmware.size;) {
      checkCanceled(signal);
      const length = Math.min(chunkBytes, release.firmware.size - offset);
      const data = await FileSystem.readFileChunk(path, offset, length, 'base64');
      if (Buffer.from(data, 'base64').length !== length) {
        throw new Error('Cached firmware ended early.');
      }
      const response = await client.command('ota.chunk', { transferId, offset, data });
      if (!record(response) || response.transferId !== transferId || response.offset !== offset + length) {
        throw new Error('Firmware chunk was not acknowledged at the expected offset.');
      }
      offset += length;
      progress('Transferring over Bluetooth', Math.floor(offset * 100 / release.firmware.size));
    }
    checkCanceled(signal);
    progress('Verifying firmware on the ESP');
    finishing = true;
    const finish = await client.command('ota.finish', { transferId });
    if (!record(finish) || finish.state !== 'restarting' || finish.version !== release.version ||
        finish.receivedBytes !== release.firmware.size) {
      throw new Error('Final update acknowledgement is invalid; checking the running firmware.');
    }
  } catch (error) {
    if (!finishing || error instanceof DeviceError) {
      if (transferId && !(error instanceof DeviceError)) {
        try {
          const aborted = await client.command('ota.abort', { transferId });
          if (!record(aborted) || aborted.state !== 'aborted') {
            throw new Error('Abort was not acknowledged.');
          }
        } catch (abortError) {
          throw new Error(`${error instanceof Error ? error.message : 'Update failed.'} Cancellation is unconfirmed: ${abortError instanceof Error ? abortError.message : 'reconnect to inspect the ESP'}`);
        }
      }
      throw error;
    }
    // A lost final reply is ambiguous, not success. Only boot/version readback
    // below can establish that the requested image actually started.
  }
  progress('Reconnecting to verify the running firmware');
  const running = await reconnect(health.bootId, release.version, signal);
  if (running.bootId === health.bootId || running.firmware.version !== release.version ||
      running.firmware.target !== release.firmware.target) {
    throw new Error('Firmware update is NOT verified: expected a new boot and the exact release version.');
  }
  progress(`Firmware ${release.version} verified`);
}
