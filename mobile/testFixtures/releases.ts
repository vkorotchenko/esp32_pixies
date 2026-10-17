import { Release, releaseUrl } from '../src/releases';
import { PowerStatus, Status } from '../src/model';
export function powerFixture(): PowerStatus {
  return {
    revision: 1,
    supplyWatts: 60,
    ledMilliWatts: 300,
    headroomPercent: 20,
    volts: 5,
    maximumMa: 9000,
    budgetMa: 9000,
    ready: true,
    recovery: 'none',
  };
}
export function releaseFixture(): Release {
  return {
    schemaVersion: 1,
    version: '0.3.1',
    commit: 'c'.repeat(40),
    firmware: {
      name: 'pixies-firmware.bin',
      size: 1024,
      sha256: 'a'.repeat(64),
      url: releaseUrl('0.3.1', 'pixies-firmware.bin'),
      target: 'esp32s3_n16r8',
      bleOtaProtocol: 1,
    },
    android: {
      name: 'pixies-android.apk',
      size: 20000,
      sha256: 'b'.repeat(64),
      url: releaseUrl('0.3.1', 'pixies-android.apk'),
      packageName: 'com.pixies.controller',
      versionCode: 3,
      certificateSha256: 'd'.repeat(64),
    },
  };
}
export function healthFixture(): Status {
  return {
    bootId: 'old-boot',
    firmware: { version: '0.3.0', target: 'esp32s3_n16r8' },
    led: { ready: true, gpio: 4, frames: 50, estimatedMa: 100, limited: false },
    network: {
      state: 'setup_ap',
      hostname: '',
      connected: false,
      ip: '',
      ssid: '',
      candidateState: 'idle',
      error: '',
      wifiSaved: false,
    },
    admin: { configured: false },
    update: { busy: false, bleOtaProtocol: 1 },
  };
}
