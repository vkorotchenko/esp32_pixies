import React from 'react';
import TestRenderer, { act, ReactTestRenderer } from 'react-test-renderer';
import App from '../App';

const mockScan = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/ble', () => ({
  Bluetooth: class {
    scan = mockScan;
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
beforeEach(() => mockScan.mockReset().mockResolvedValue(undefined));
afterEach(async () => {
  await act(async () => rendered.unmount());
});
test('starts at device discovery without a hotspot or app-login form', async () => {
  await act(async () => {
    rendered = TestRenderer.create(<App />);
  });
  expect(
    rendered.root.findByProps({ label: 'Scan controllers' }),
  ).toBeDefined();
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
