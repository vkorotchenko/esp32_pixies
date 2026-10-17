import React from 'react';
import TestRenderer, { act, ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import App from '../App';
import { PixiesClient } from '../src/client';
import { isConfig, Snapshot } from '../src/model';
import { healthFixture } from '../testFixtures/releases';
jest.mock('react-native-file-access', () => ({ Dirs: { CacheDir: '/cache' }, FileSystem: {} }));

const mockScan = jest.fn().mockResolvedValue(undefined);
const mockConnect = jest.fn();
jest.mock('../src/ble', () => ({
  Bluetooth: class {
    scan = mockScan;
    connect = mockConnect;
    stopScan = jest.fn();
    close = jest.fn().mockResolvedValue(undefined);
    destroy = jest.fn().mockResolvedValue(undefined);
  },
}));
jest.mock('@react-native-community/slider', () => 'Slider');
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaProvider: View, SafeAreaView: View };
});

let rendered: ReactTestRenderer;
beforeEach(() => {
  mockScan.mockReset().mockResolvedValue(undefined);
  mockConnect.mockReset().mockResolvedValue({
    mtu: 247, write: jest.fn().mockResolvedValue(undefined), subscribe: () => jest.fn(),
  });
});
afterEach(async () => {
  await act(async () => rendered.unmount());
  jest.restoreAllMocks();
});
test('starts at device discovery without a hotspot or app-login form', async () => {
  await act(async () => {
    rendered = TestRenderer.create(<App />);
  });
  expect(
    rendered.root.findByProps({ label: 'Scan controllers' }),
  ).toBeDefined();
  expect(rendered.root.findByProps({ label: 'Check for updates' })).toBeDefined();
  expect(
    rendered.root.findAllByProps({ accessibilityLabel: 'Wi-Fi password' }),
  ).toHaveLength(0);
  await act(async () => {
    rendered.root.findByProps({ label: 'Scan controllers' }).props.onPress();
  });
  expect(mockScan).toHaveBeenCalledTimes(1);
});
test('makes permission/connection errors visible rather than pretending to connect', async () => {
  mockScan.mockRejectedValue(new Error('Bluetooth permission denied'));
  await act(async () => {
    rendered = TestRenderer.create(<App />);
  });
  await act(async () => {
    rendered.root.findByProps({ label: 'Scan controllers' }).props.onPress();
  });
  expect(
    rendered.root.findByProps({ accessibilityRole: 'alert' }).props.children,
  ).toBe('Bluetooth permission denied');
});
function configuration(): Snapshot {
  return {
    schemaVersion: 1, bootId: '0123456789abcdef', revision: 1, savedRevision: 1,
    dirty: false, activeLedCount: 200, requestedLedCount: 200, savedLedCount: 200,
    restartRequired: false, savedRestartRequired: false,
    config: { ledCount: 200, on: true, brightness: 25, speed: 50, intensity: 50,
      density: 50, effect: 'twinkle', paletteId: 'builtin:light-blue', customPalettes: [] },
  };
}
async function connectController() {
  mockScan.mockImplementation(async found => found({ id: 'original-id', name: 'pixies', rssi: null }));
  await act(async () => { rendered = TestRenderer.create(<App />); });
  await act(async () => { rendered.root.findByProps({ label: 'Scan controllers' }).props.onPress(); });
  await act(async () => { await rendered.root.findByProps({ label: 'pixies' }).props.onPress(); });
  expect(mockConnect).toHaveBeenCalledWith('original-id', expect.any(Function));
}
test('Preview explains Save without implying a reboot or claiming unchanged saved settings are unsaved', async () => {
  const current = configuration();
  const command = jest.spyOn(PixiesClient.prototype, 'command').mockImplementation(async op => {
    if (op === 'status') { return { ...healthFixture(), bootId: current.bootId }; }
    if (op === 'config') { return current; }
    if (op === 'config.set') { return { ...current, revision: 2 }; }
    throw new Error(`Unexpected operation: ${op}`);
  });
  await connectController();
  await act(async () => { rendered.root.findByProps({ label: 'Preview' }).props.onPress(); });
  expect(rendered.root.findByProps({ testID: 'operation-status' }).props.children)
    .toBe('Preview active. Tap Save to keep it.');
  expect(command.mock.calls.map(([op]) => op)).toEqual(['config', 'status', 'config.set']);
});
test.each([[false, false], [true, false], [false, true]])('Save feedback stays in place (count changed: %s, save fails: %s)', async (countChanged, failSave) => {
  let current = configuration();
  let finishSave: (value: unknown) => void = () => {};
  let rejectSave: (error: Error) => void = () => {};
  const command = jest.spyOn(PixiesClient.prototype, 'command').mockImplementation(async (op, args) => {
    if (op === 'config') { return current; }
    if (op === 'status') { return { ...healthFixture(), bootId: current.bootId }; }
    if (op === 'config.set') {
      const config = args?.config;
      if (!isConfig(config)) { throw new Error('Invalid configuration sent by the app'); }
      current = {
        ...current, config,
        revision: 2, dirty: true,
      };
      current.requestedLedCount = current.config.ledCount;
      current.restartRequired = current.requestedLedCount !== current.activeLedCount;
      return current;
    }
    if (op === 'config.save') {
      return new Promise((resolve, reject) => { finishSave = resolve; rejectSave = reject; });
    }
    throw new Error(`Unexpected operation: ${op}`);
  });
  await connectController();
  if (countChanged) {
    await act(async () => {
      rendered.root.findByProps({ accessibilityLabel: 'LED count' }).props.onChangeText('333');
    });
  }
  const content = rendered.root.findByProps({ testID: 'operation-status' }).parent;
  if (!content) { throw new Error('Status area has no layout parent'); }
  const childCount = content.children.length;
  expect(childCount).toBeGreaterThan(3);
  const style = StyleSheet.flatten(rendered.root.findByProps({ testID: 'operation-status' }).props.style);
  expect(style.minHeight).toBeGreaterThanOrEqual(72);
  await act(async () => { rendered.root.findByProps({ label: 'Save' }).props.onPress(); });
  expect(rendered.root.findByProps({ label: 'Save' }).props.disabled).toBe(true);
  expect(rendered.root.findByProps({ testID: 'operation-status' }).props.children).toBe('Saving...');
  expect(rendered.root.findByProps({ testID: 'operation-status' }).parent?.children).toHaveLength(childCount);
  expect(rendered.root.findAllByProps({ children: 'Working...' })).toHaveLength(0);
  expect(StyleSheet.flatten(rendered.root.findByProps({ testID: 'operation-status' }).props.style)).toEqual(style);
  await act(async () => { rendered.root.findByProps({ label: 'Save' }).props.onPress(); });
  expect(command.mock.calls.map(([op]) => op)).toEqual(['config', 'status', 'config.set', 'config.save']);
  await act(async () => {
    if (failSave) {
      rejectSave(new Error('Saving failed. Try again.'));
    } else {
      finishSave({
        ...current, dirty: false, savedRevision: 2, savedLedCount: current.requestedLedCount,
        savedRestartRequired: countChanged,
      });
    }
  });
  expect(rendered.root.findByProps({ testID: 'operation-status' }).props.children).toBe(failSave
    ? 'Saving failed. Try again.'
    : countChanged ? 'Saved. Restart for the LED count only.' : 'Saved. No restart needed.');
  expect(rendered.root.findByProps({ testID: 'operation-status' }).props.accessibilityRole).toBe('alert');
  expect(rendered.root.findByProps({ label: 'Save' }).props.disabled).toBe(false);
  expect(rendered.root.findByProps({ testID: 'operation-status' }).parent?.children).toHaveLength(childCount);
  expect(command.mock.calls.map(([op]) => op)).toEqual(['config', 'status', 'config.set', 'config.save']);
  expect(mockConnect).toHaveBeenCalledTimes(1);
});
