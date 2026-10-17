import {
  isConfig,
  snapshot,
  status,
  validateWifi,
  wifiScan,
  Config,
} from '../src/model';

const config: Config = {
  ledCount: 200,
  on: true,
  brightness: 25,
  speed: 50,
  intensity: 50,
  density: 50,
  effect: 'twinkle',
  paletteId: 'builtin:light-blue',
  customPalettes: [],
};
test('accepts clean defaults and all preexisting seasonal/custom choices', () => {
  expect(isConfig(config)).toBe(true);
  for (const effect of ['steady', 'twinkle', 'candle', 'breathe', 'chase']) {
    for (const paletteId of ['halloween', 'christmas', 'light-blue']) {
      expect(
        isConfig({
          ...config,
          effect,
          paletteId,
          customPalettes: [
            { id: 'light-blue', name: 'Existing', colors: ['#123456'] },
          ],
        }),
      ).toBe(true);
    }
  }
});
test('enforces every numeric, palette and complete-object boundary before sending', () => {
  for (const ledCount of [0, 1001, 1.2, true]) {
    expect(isConfig({ ...config, ledCount })).toBe(false);
  }
  for (const key of ['brightness', 'speed', 'intensity', 'density']) {
    for (const value of [-1, 101, 0.5, true]) {
      expect(isConfig({ ...config, [key]: value })).toBe(false);
    }
  }
  expect(isConfig({ ...config, extra: 1 })).toBe(false);
  expect(
    isConfig({
      ...config,
      customPalettes: [{ id: 'halloween', name: 'Bad', colors: ['#FF0000'] }],
    }),
  ).toBe(false);
  expect(
    isConfig({
      ...config,
      customPalettes: [
        { id: 'builtin:light-blue', name: 'Bad', colors: ['#FF0000'] },
      ],
    }),
  ).toBe(false);
});
test('rejects missing device responses instead of making synthetic state', () => {
  expect(() => snapshot({ config })).toThrow();
  expect(() => status({})).toThrow();
  expect(() => wifiScan({ state: 'complete', networks: [{}] })).toThrow();
});
test('validates UTF-8 Wi-Fi byte boundaries, open networks and raw keys', () => {
  expect(() => validateWifi('灯泡', 'fixture-only-password')).not.toThrow();
  expect(() => validateWifi('Open fixture', '')).not.toThrow();
  expect(() => validateWifi('Fixture', 'a'.repeat(64))).not.toThrow();
  expect(() => validateWifi('é'.repeat(17), 'fixture-only-password')).toThrow();
  expect(() => validateWifi('Fixture', 'short')).toThrow();
  expect(() => validateWifi('Fixture', 'z'.repeat(64))).toThrow();
});
