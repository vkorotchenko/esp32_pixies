import React from 'react';
import { Alert, Platform } from 'react-native';
import TestRenderer, { act, ReactTestRenderer } from 'react-test-renderer';
import { UpdatePanel } from '../src/UpdatePanel';
import { latestRelease } from '../src/releases';
import { download, installer } from '../src/updates';
import { releaseFixture } from '../testFixtures/releases';

jest.mock('react-native-file-access', () => ({ Dirs: { CacheDir: '/cache' }, FileSystem: {} }));
jest.mock('../src/releases', () => ({
  ...jest.requireActual('../src/releases'), latestRelease: jest.fn(),
}));
jest.mock('../src/updates', () => ({
  ...jest.requireActual('../src/updates'), download: jest.fn(), installer: jest.fn(),
}));
const native = {
  canInstall: jest.fn(), openSettings: jest.fn(), install: jest.fn(),
};
let rendered: ReactTestRenderer;
async function press(label: string) {
  await act(async () => { await rendered.root.findByProps({ label }).props.onPress(); });
}
function message() {
  return rendered.root.findByProps({ accessibilityRole: 'alert' }).props.children;
}
beforeEach(async () => {
  jest.clearAllMocks();
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.mocked(latestRelease).mockResolvedValue(releaseFixture());
  jest.mocked(download).mockResolvedValue('/cache/pixies-updates/pixies-fixture.apk');
  jest.mocked(installer).mockReturnValue(native);
  native.openSettings.mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _text, buttons) => {
    buttons?.find(button => button.text === 'Download')?.onPress?.();
  });
  await act(async () => {
    rendered = TestRenderer.create(<UpdatePanel health={null} disabled={false}
      client={() => { throw new Error('No controller is connected'); }}
      onBusy={jest.fn()} reconnect={jest.fn()} />);
  });
  await press('Check for updates');
});
afterEach(async () => {
  await act(async () => rendered.unmount());
  jest.restoreAllMocks();
});
test('Android permission settings retain the verified APK and require explicit installation retry', async () => {
  native.canInstall.mockResolvedValue(false);
  await press('Update Android app');
  expect(native.install).not.toHaveBeenCalled();
  expect(message()).toContain('Install unknown apps');
  await press('Open Android install settings');
  expect(native.openSettings).toHaveBeenCalledTimes(1);
  native.canInstall.mockResolvedValue(true);
  native.install.mockResolvedValue('installer_opened');
  await press('Install downloaded APK');
  expect(download).toHaveBeenCalledTimes(1);
  expect(native.install).toHaveBeenCalledWith(
    '/cache/pixies-updates/pixies-fixture.apk', '0.3.1', 3, releaseFixture().android.sha256,
  );
  expect(message()).toContain('not a confirmed install');
});
test('native installer rejection stays visible and cannot report successful installation', async () => {
  native.canInstall.mockResolvedValue(true);
  native.install.mockRejectedValue(new Error('APK uses a different signing key'));
  await press('Update Android app');
  expect(message()).toBe('APK uses a different signing key');
});
