import React from 'react';
import TestRenderer, { act, ReactTestRenderer } from 'react-test-renderer';
import {
  AppState,
  AppStateStatus,
  BackHandler,
  Platform,
  StyleSheet,
} from 'react-native';
import App from '../App';
import { PixiesClient } from '../src/client';
import { isConfig, Snapshot } from '../src/model';
import { healthFixture, powerFixture } from '../testFixtures/releases';
import { releaseFixture } from '../testFixtures/releases';
import {
  rememberedController,
  rememberController,
} from '../src/controllerPreference';
import { latestRelease, NoPublishedRelease } from '../src/releases';
import { UpdatePanel } from '../src/UpdatePanel';
import { PowerNotice } from '../src/PowerSettings';
jest.mock('react-native-file-access', () => ({
  Dirs: { CacheDir: '/cache' },
  FileSystem: {},
}));
jest.mock('../src/controllerPreference', () => ({
  rememberedController: jest.fn(),
  rememberController: jest.fn(),
}));
jest.mock('../src/releases', () => ({
  ...jest.requireActual('../src/releases'),
  latestRelease: jest.fn(),
}));
jest.mock('../src/version', () => ({
  APP_VERSION: '0.3.0',
  APP_VERSION_CODE: 2,
}));

const mockScan = jest.fn().mockResolvedValue(undefined);
const mockConnect = jest.fn();
const mockOnPoweredOn = jest.fn();
jest.mock('../src/ble', () => ({
  Bluetooth: class {
    scan = mockScan;
    connect = mockConnect;
    onPoweredOn = mockOnPoweredOn;
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
let unmounted = false;
const lifecycle = new Set<(state: AppStateStatus) => void>();
beforeEach(() => {
  unmounted = false;
  lifecycle.clear();
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      lifecycle.add(listener);
      return { remove: () => lifecycle.delete(listener) };
    });
  jest.replaceProperty(Platform, 'OS', 'android');
  mockScan
    .mockReset()
    .mockImplementation(async (_found, _failed, ended) => ended());
  mockOnPoweredOn.mockReset().mockReturnValue(jest.fn());
  jest.mocked(rememberedController).mockReset().mockResolvedValue(null);
  jest.mocked(rememberController).mockReset().mockResolvedValue(undefined);
  jest
    .mocked(latestRelease)
    .mockReset()
    .mockRejectedValue(new NoPublishedRelease());
  mockConnect.mockReset().mockResolvedValue({
    mtu: 247,
    write: jest.fn().mockResolvedValue(undefined),
    subscribe: () => jest.fn(),
  });
});
afterEach(async () => {
  if (!unmounted) {
    await act(async () => rendered.unmount());
  }
  jest.restoreAllMocks();
});
function expectHome() {
  expect(
    StyleSheet.flatten(
      rendered.root.findByProps({ testID: 'settings-panel' }).props.style,
    ).display,
  ).toBe('none');
  expect(
    rendered.root.findByProps({ testID: 'lighting-home' }).props
      .importantForAccessibility,
  ).toBe('auto');
  expect(
    rendered.root.findByProps({ accessibilityLabel: 'LED count' }),
  ).toBeDefined();
}
async function openSettings(name: string) {
  await act(async () =>
    rendered.root
      .findByProps({ testID: 'settings-menu-toggle' })
      .props.onPress(),
  );
  await act(async () =>
    rendered.root.findByProps({ label: name }).props.onPress(),
  );
}
async function expectAttention(name: string, value: boolean) {
  await act(async () =>
    rendered.root
      .findByProps({ testID: 'settings-menu-toggle' })
      .props.onPress(),
  );
  expect(rendered.root.findByProps({ label: name }).props.attention).toBe(
    value,
  );
  await act(async () =>
    rendered.root
      .findByProps({ testID: 'settings-menu-toggle' })
      .props.onPress(),
  );
}
test('opens the full disabled Lights form immediately with settings hidden behind the icon', async () => {
  await act(async () => {
    rendered = TestRenderer.create(<App />);
  });
  expectHome();
  expect(
    rendered.root.findAllByProps({ testID: 'settings-dropdown' }),
  ).toHaveLength(0);
  expect(
    rendered.root.findByProps({ testID: 'settings-menu-toggle' }).props
      .accessibilityLabel,
  ).toBe('Settings, attention needed');
  await expectAttention('Connection', true);
  await expectAttention('Updates', false);
  expect(
    rendered.root.findByProps({ accessibilityLabel: 'Lights on' }).props
      .disabled,
  ).toBe(true);
  expect(
    rendered.root.findByProps({ accessibilityLabel: 'brightness' }).props
      .disabled,
  ).toBe(true);
  expect(
    rendered.root.findByProps({ accessibilityLabel: 'LED count' }).props
      .disabled,
  ).toBe(true);
  expect(rendered.root.findByProps({ label: 'Save' }).props.disabled).toBe(
    true,
  );
  expect(
    StyleSheet.flatten(
      rendered.root.findByProps({ testID: 'lighting-controls' }).props.style,
    ).opacity,
  ).toBeLessThan(1);
  expect(
    StyleSheet.flatten(
      rendered.root.findByProps({ testID: 'updates-panel' }).props.style,
    ).display,
  ).toBe('none');
  expect(
    rendered.root.findAllByProps({ label: 'Scan controllers' }),
  ).toHaveLength(0);
  expect(
    rendered.root.findAllByProps({ accessibilityLabel: 'Wi-Fi password' }),
  ).toHaveLength(0);
  expect(mockScan).toHaveBeenCalledTimes(1);
  expect(latestRelease).toHaveBeenCalledTimes(1);
});
test('makes permission/connection errors visible rather than pretending to connect', async () => {
  mockScan.mockRejectedValue(new Error('Bluetooth permission denied'));
  await act(async () => {
    rendered = TestRenderer.create(<App />);
  });
  expectHome();
  await expectAttention('Connection', true);
  await openSettings('Connection');
  expect(
    rendered.root.findByProps({ testID: 'connection-status' }).props.children,
  ).toBe('Bluetooth permission denied');
});
function configuration(): Snapshot {
  return {
    schemaVersion: 1,
    bootId: '0123456789abcdef',
    revision: 1,
    savedRevision: 1,
    dirty: false,
    activeLedCount: 200,
    requestedLedCount: 200,
    savedLedCount: 200,
    restartRequired: false,
    savedRestartRequired: false,
    config: {
      ledCount: 200,
      on: true,
      brightness: 25,
      speed: 50,
      intensity: 50,
      density: 50,
      effect: 'twinkle',
      paletteId: 'builtin:light-blue',
      customPalettes: [],
    },
  };
}
async function connectController() {
  mockScan.mockImplementation(async (found, _failed, ended) => {
    found({ id: 'original-id', name: 'pixies', rssi: null });
    found({ id: 'original-id', name: 'pixies', rssi: null });
    ended();
  });
  await act(async () => {
    rendered = TestRenderer.create(<App />);
  });
  expect(mockConnect).toHaveBeenCalledWith(
    'original-id',
    expect.any(Function),
    expect.objectContaining({ aborted: false }),
  );
  expect(rememberController).toHaveBeenCalledWith('original-id');
  expectHome();
  await expectAttention('Connection', false);
}
test('reconnects the remembered native ID without scanning or switching away from Lights', async () => {
  const current = configuration();
  jest.mocked(rememberedController).mockResolvedValue('remembered-id');
  const command = jest
    .spyOn(PixiesClient.prototype, 'command')
    .mockImplementation(async op =>
      op === 'config'
        ? current
        : { ...healthFixture(), bootId: current.bootId },
    );
  await act(async () => {
    rendered = TestRenderer.create(<App />);
  });
  expect(mockConnect).toHaveBeenCalledWith(
    'remembered-id',
    expect.any(Function),
    expect.anything(),
  );
  expect(mockScan).not.toHaveBeenCalled();
  expect(command.mock.calls.map(([op]) => op)).toEqual(['config', 'status']);
  expectHome();
});
test('never substitutes another controller when the remembered one cannot connect', async () => {
  jest.mocked(rememberedController).mockResolvedValue('missing-id');
  mockConnect.mockRejectedValue(new Error('Controller unavailable'));
  await act(async () => {
    rendered = TestRenderer.create(<App />);
  });
  expect(mockConnect).toHaveBeenCalledTimes(1);
  expect(mockScan).not.toHaveBeenCalled();
  expectHome();
  await expectAttention('Connection', true);
});
test('multiple first-use controllers require a choice in Connection instead of guessing', async () => {
  mockScan.mockImplementation(async (found, _failed, ended) => {
    found({ id: 'one', name: 'pixies', rssi: -40 });
    found({ id: 'two', name: 'pixies', rssi: -60 });
    ended();
  });
  await act(async () => {
    rendered = TestRenderer.create(<App />);
  });
  expect(mockConnect).not.toHaveBeenCalled();
  expectHome();
  await openSettings('Connection');
  expect(
    rendered.root.findByProps({ label: 'pixies (-40 dBm)' }),
  ).toBeDefined();
  expect(
    rendered.root.findByProps({ label: 'pixies (-60 dBm)' }),
  ).toBeDefined();
});
test('an available update marks the settings icon and Updates item without opening settings or an installer', async () => {
  jest.mocked(latestRelease).mockResolvedValue(releaseFixture());
  await act(async () => {
    rendered = TestRenderer.create(<App />);
  });
  expectHome();
  expect(
    StyleSheet.flatten(
      rendered.root.findByProps({ testID: 'updates-panel' }).props.style,
    ).display,
  ).toBe('none');
  await act(async () =>
    rendered.root
      .findByProps({ testID: 'settings-menu-toggle' })
      .props.onPress(),
  );
  const tab = rendered.root.findByProps({
    accessibilityLabel: 'Updates, attention needed',
  });
  expect(tab.props.accessibilityRole).toBe('button');
  expect(
    tab.findAll(
      node =>
        StyleSheet.flatten(node.props.style)?.backgroundColor === '#fb923c' &&
        StyleSheet.flatten(node.props.style)?.opacity !== 0,
    ).length,
  ).toBeGreaterThan(0);
});
test('offline update checks never block the Lights screen and remain visible in Updates', async () => {
  jest
    .mocked(latestRelease)
    .mockRejectedValue(new Error('Internet unavailable'));
  await act(async () => {
    rendered = TestRenderer.create(<App />);
  });
  expectHome();
  await expectAttention('Updates', true);
  await openSettings('Updates');
  expect(
    rendered.root.findByProps({ testID: 'update-check-status' }).props.children,
  ).toBe('Internet unavailable');
});
test('an update check never locks lighting controls after automatic connection', async () => {
  const current = configuration();
  jest.mocked(latestRelease).mockReturnValue(new Promise(() => {}));
  jest
    .spyOn(PixiesClient.prototype, 'command')
    .mockImplementation(async op =>
      op === 'config'
        ? current
        : { ...healthFixture(), bootId: current.bootId },
    );
  await connectController();
  expect(rendered.root.findByProps({ label: 'Save' }).props.disabled).toBe(
    false,
  );
  expect(
    rendered.root.findByProps({ testID: 'update-check-status' }).props.children,
  ).toBe('Checking for updates...');
});
test('Bluetooth becoming available retries connection without changing the selected tab', async () => {
  mockScan.mockRejectedValueOnce(new Error('Turn on Bluetooth'));
  await act(async () => {
    rendered = TestRenderer.create(<App />);
  });
  await act(async () => {
    mockOnPoweredOn.mock.calls[0][0]();
  });
  expect(mockScan).toHaveBeenCalledTimes(2);
  expectHome();
});
test('backgrounding cancels stale startup work and foregrounding starts one fresh attempt', async () => {
  let finish: (id: string | null) => void = () => {};
  jest.mocked(rememberedController).mockReturnValueOnce(
    new Promise(resolve => {
      finish = resolve;
    }),
  );
  await act(async () => {
    rendered = TestRenderer.create(<App />);
  });
  await act(async () => {
    lifecycle.forEach(listener => listener('background'));
  });
  await act(async () => {
    lifecycle.forEach(listener => listener('active'));
  });
  await act(async () => {
    finish(null);
  });
  expect(mockScan).toHaveBeenCalledTimes(1);
  expectHome();
});
test('unmounting prevents a late preference read from starting a Bluetooth operation', async () => {
  let finish: (id: string | null) => void = () => {};
  jest.mocked(rememberedController).mockReturnValueOnce(
    new Promise(resolve => {
      finish = resolve;
    }),
  );
  await act(async () => {
    rendered = TestRenderer.create(<App />);
  });
  await act(async () => {
    rendered.unmount();
    unmounted = true;
  });
  await act(async () => {
    finish('original-id');
  });
  expect(mockConnect).not.toHaveBeenCalled();
  expect(mockScan).not.toHaveBeenCalled();
});
test('manual disconnection stays disconnected until a later foreground session', async () => {
  const current = configuration();
  jest
    .spyOn(PixiesClient.prototype, 'command')
    .mockImplementation(async op =>
      op === 'config'
        ? current
        : { ...healthFixture(), bootId: current.bootId },
    );
  await connectController();
  await openSettings('Connection');
  await act(async () => {
    rendered.root.findByProps({ label: 'Disconnect' }).props.onPress();
  });
  expect(mockConnect).toHaveBeenCalledTimes(1);
  await expectAttention('Connection', true);
  await act(async () => {
    lifecycle.forEach(listener => listener('background'));
  });
  await act(async () => {
    lifecycle.forEach(listener => listener('active'));
  });
  expect(mockConnect).toHaveBeenCalledTimes(2);
});
test('a system pairing or permission dialog does not cancel or repeat the connection attempt', async () => {
  let endScan: () => void = () => {};
  mockScan.mockImplementation(async (_found, _failed, ended) => {
    endScan = ended;
  });
  await act(async () => {
    rendered = TestRenderer.create(<App />);
  });
  const signal: AbortSignal = mockScan.mock.calls[0][3];
  await act(async () => {
    lifecycle.forEach(listener => listener('inactive'));
  });
  expect(signal.aborted).toBe(false);
  await act(async () => {
    lifecycle.forEach(listener => listener('active'));
  });
  expect(mockScan).toHaveBeenCalledTimes(1);
  await act(async () => {
    endScan();
  });
  expect(mockScan).toHaveBeenCalledTimes(1);
});
test('a failed preference read does not silently turn into first-use controller selection', async () => {
  jest
    .mocked(rememberedController)
    .mockRejectedValue(new Error('Saved controller identity is invalid'));
  await act(async () => {
    rendered = TestRenderer.create(<App />);
  });
  expect(mockScan).not.toHaveBeenCalled();
  expect(mockConnect).not.toHaveBeenCalled();
  expectHome();
  await expectAttention('Connection', true);
});
test('Preview explains Save without implying a reboot or claiming unchanged saved settings are unsaved', async () => {
  const current = configuration();
  const command = jest
    .spyOn(PixiesClient.prototype, 'command')
    .mockImplementation(async op => {
      if (op === 'status') {
        return { ...healthFixture(), bootId: current.bootId };
      }
      if (op === 'config') {
        return current;
      }
      if (op === 'config.set') {
        return { ...current, revision: 2 };
      }
      throw new Error(`Unexpected operation: ${op}`);
    });
  await connectController();
  await act(async () => {
    rendered.root.findByProps({ label: 'Preview' }).props.onPress();
  });
  expect(
    rendered.root.findByProps({ testID: 'operation-status' }).props.children,
  ).toBe('Preview active. Tap Save to keep it.');
  expect(command.mock.calls.map(([op]) => op)).toEqual([
    'config',
    'status',
    'config.set',
  ]);
});
test('settings dismiss on outside tap and hardware Back; every page retains the same update component and lighting home', async () => {
  let back: () => boolean | null | undefined = () => false;
  jest
    .spyOn(BackHandler, 'addEventListener')
    .mockImplementation((_event, handler) => {
      back = handler;
      return { remove: jest.fn() };
    });
  await act(async () => {
    rendered = TestRenderer.create(<App />);
  });
  const update = rendered.root.findByType(UpdatePanel);
  const lights = rendered.root.findByProps({ testID: 'lighting-home' });
  await act(async () =>
    rendered.root
      .findByProps({ testID: 'settings-menu-toggle' })
      .props.onPress(),
  );
  await act(async () =>
    rendered.root
      .findByProps({ accessibilityLabel: 'Dismiss settings menu' })
      .props.onPress(),
  );
  expect(
    rendered.root.findByProps({ testID: 'settings-menu-toggle' }).props
      .accessibilityState.expanded,
  ).toBe(false);
  await act(async () =>
    rendered.root
      .findByProps({ testID: 'settings-menu-toggle' })
      .props.onPress(),
  );
  await act(async () => expect(back()).toBe(true));
  expectHome();
  for (const page of ['Updates', 'Connection', 'Wi-Fi', 'Device settings']) {
    await openSettings(page);
    expect(rendered.root.findByType(UpdatePanel)).toBe(update);
    expect(rendered.root.findByProps({ testID: 'lighting-home' })).toBe(lights);
    expect(lights.props.importantForAccessibility).toBe('no-hide-descendants');
    await act(async () => expect(back()).toBe(true));
    expectHome();
  }
  expect(back()).toBe(false);
  expect(latestRelease).toHaveBeenCalledTimes(1);
});
test('disconnect retains authoritative values, discards drafts and never replays them on reconnect', async () => {
  const current = configuration();
  current.config.brightness = 31;
  const command = jest
    .spyOn(PixiesClient.prototype, 'command')
    .mockImplementation(async op =>
      op === 'config'
        ? current
        : { ...healthFixture(), bootId: current.bootId },
    );
  await connectController();
  await act(async () =>
    rendered.root
      .findByProps({ accessibilityLabel: 'brightness' })
      .props.onValueChange(90),
  );
  await openSettings('Connection');
  await act(async () =>
    rendered.root.findByProps({ label: 'Disconnect' }).props.onPress(),
  );
  const brightness = rendered.root.findByProps({
    accessibilityLabel: 'brightness',
  });
  expect(brightness.props.value).toBe(31);
  expect(brightness.props.disabled).toBe(true);
  await act(async () =>
    rendered.root
      .findByProps({ label: 'Reconnect automatically' })
      .props.onPress(),
  );
  expect(brightness.props.disabled).toBe(false);
  expect(command.mock.calls.map(([op]) => op)).toEqual([
    'config',
    'status',
    'config',
    'status',
  ]);
});
test.each([1, 333])(
  'preserves a valid existing count of %s until the user moves the 25-step slider',
  async ledCount => {
    let current = configuration();
    current = {
      ...current,
      activeLedCount: ledCount,
      savedLedCount: ledCount,
      requestedLedCount: ledCount,
      config: { ...current.config, ledCount },
    };
    const command = jest
      .spyOn(PixiesClient.prototype, 'command')
      .mockImplementation(async (op, args) => {
        if (op === 'status')
          return { ...healthFixture(), bootId: current.bootId };
        if (op === 'config') return current;
        if (op === 'config.set' && isConfig(args?.config)) {
          current = {
            ...current,
            config: args.config,
            revision: current.revision + 1,
            requestedLedCount: args.config.ledCount,
            restartRequired: args.config.ledCount !== current.activeLedCount,
          };
          return current;
        }
        throw new Error(`Unexpected operation ${op}`);
      });
    await connectController();
    expect(
      rendered.root.findByProps({ accessibilityLabel: 'LED count' }).props,
    ).toMatchObject({
      minimumValue: 25,
      maximumValue: 1000,
      step: 25,
    });
    await act(async () =>
      rendered.root.findByProps({ label: 'Preview' }).props.onPress(),
    );
    expect(command.mock.calls.at(-1)?.[1]?.config).toMatchObject({
      ledCount,
    });
    await act(async () =>
      rendered.root
        .findByProps({ accessibilityLabel: 'LED count' })
        .props.onValueChange(351),
    );
    await act(async () =>
      rendered.root.findByProps({ label: 'Preview' }).props.onPress(),
    );
    expect(command.mock.calls.at(-1)?.[1]?.config).toMatchObject({
      ledCount: 350,
    });
  },
);
test('power warnings retain the active physical count while a smaller count awaits restart', async () => {
  const current = configuration();
  current.activeLedCount = 900;
  current.restartRequired = true;
  current.savedRestartRequired = true;
  jest.spyOn(PixiesClient.prototype, 'command').mockImplementation(async op =>
    op === 'config'
      ? current
      : {
          ...healthFixture(),
          bootId: current.bootId,
          power: powerFixture(),
        },
  );
  await connectController();
  await act(async () =>
    rendered.root
      .findByProps({ accessibilityLabel: 'LED count' })
      .props.onValueChange(25),
  );
  expect(rendered.root.findByType(PowerNotice).props.count).toBe(900);
});
test.each(['success', 'storage failure', 'revision conflict', 'new boot'])(
  'power Save is independent, checked and does not restart: %s',
  async outcome => {
    const current = configuration();
    const health = {
      ...healthFixture(),
      bootId: current.bootId,
      power: powerFixture(),
    };
    const command = jest
      .spyOn(PixiesClient.prototype, 'command')
      .mockImplementation(async (op, args) => {
        if (op === 'config') return current;
        if (op === 'status') return health;
        if (op === 'power.save') {
          expect(args).toEqual({
            baseRevision: 1,
            power: { supplyWatts: 20, ledMilliWatts: 600 },
          });
          if (outcome === 'storage failure' || outcome === 'revision conflict')
            throw new Error(outcome);
          return {
            ...health,
            bootId: outcome === 'new boot' ? 'different-boot' : current.bootId,
            power: {
              ...powerFixture(),
              revision: 2,
              supplyWatts: 20,
              ledMilliWatts: 600,
              budgetMa: 3200,
            },
          };
        }
        throw new Error(`Unexpected operation ${op}`);
      });
    await connectController();
    await openSettings('Device settings');
    await act(async () => {
      rendered.root
        .findByProps({ accessibilityLabel: 'Power supply wattage' })
        .props.onChangeText('20');
      rendered.root
        .findByProps({ accessibilityLabel: 'Power per LED' })
        .props.onChangeText('0,6');
    });
    await act(async () =>
      rendered.root
        .findByProps({ accessibilityLabel: 'Save power settings' })
        .props.onPress(),
    );
    const message = rendered.root.findByProps({ testID: 'settings-status' })
      .props.children;
    expect(message).toBe(
      outcome === 'success'
        ? 'Power settings saved. Protection is active; no restart needed.'
        : outcome === 'new boot'
        ? 'Power save is not confirmed. Refresh device status before retrying.'
        : outcome,
    );
    expect(command.mock.calls.map(([op]) => op)).toEqual([
      'config',
      'status',
      'power.save',
    ]);
    expect(mockConnect).toHaveBeenCalledTimes(1);
    if (outcome !== 'success') {
      expect(
        rendered.root.findByType(UpdatePanel).props.health.power.supplyWatts,
      ).toBe(60);
      expect(
        rendered.root.findByProps({
          accessibilityLabel: 'Power supply wattage',
        }).props.value,
      ).toBe('20');
    }
  },
);
test('older firmware keeps working lighting controls and explicitly disables unsupported power editing', async () => {
  const current = configuration();
  jest
    .spyOn(PixiesClient.prototype, 'command')
    .mockImplementation(async op =>
      op === 'config'
        ? current
        : { ...healthFixture(), bootId: current.bootId },
    );
  await connectController();
  expect(rendered.root.findByProps({ label: 'Save' }).props.disabled).toBe(
    false,
  );
  await openSettings('Device settings');
  expect(
    rendered.root.findByProps({ accessibilityLabel: 'Power supply wattage' })
      .props.editable,
  ).toBe(false);
  expect(
    rendered.root.findByProps({ accessibilityLabel: 'Save power settings' })
      .props.disabled,
  ).toBe(true);
  expect(JSON.stringify(rendered.toJSON())).toContain(
    'Update controller firmware to configure supply wattage',
  );
});
test.each([
  [false, false],
  [true, false],
  [false, true],
])(
  'Save feedback stays in place (count changed: %s, save fails: %s)',
  async (countChanged, failSave) => {
    let current = configuration();
    let finishSave: (value: unknown) => void = () => {};
    let rejectSave: (error: Error) => void = () => {};
    const command = jest
      .spyOn(PixiesClient.prototype, 'command')
      .mockImplementation(async (op, args) => {
        if (op === 'config') {
          return current;
        }
        if (op === 'status') {
          return { ...healthFixture(), bootId: current.bootId };
        }
        if (op === 'config.set') {
          const config = args?.config;
          if (!isConfig(config)) {
            throw new Error('Invalid configuration sent by the app');
          }
          current = {
            ...current,
            config,
            revision: 2,
            dirty: true,
          };
          current.requestedLedCount = current.config.ledCount;
          current.restartRequired =
            current.requestedLedCount !== current.activeLedCount;
          return current;
        }
        if (op === 'config.save') {
          return new Promise((resolve, reject) => {
            finishSave = resolve;
            rejectSave = reject;
          });
        }
        throw new Error(`Unexpected operation: ${op}`);
      });
    await connectController();
    if (countChanged) {
      await act(async () => {
        rendered.root
          .findByProps({ accessibilityLabel: 'LED count' })
          .props.onValueChange(333);
      });
    }
    const content = rendered.root.findByProps({
      testID: 'operation-status',
    }).parent;
    if (!content) {
      throw new Error('Status area has no layout parent');
    }
    const childCount = content.children.length;
    expect(childCount).toBeGreaterThanOrEqual(2);
    const style = StyleSheet.flatten(
      rendered.root.findByProps({ testID: 'operation-status' }).props.style,
    );
    expect(style.minHeight).toBeGreaterThanOrEqual(72);
    await act(async () => {
      rendered.root.findByProps({ label: 'Save' }).props.onPress();
    });
    expect(rendered.root.findByProps({ label: 'Save' }).props.disabled).toBe(
      true,
    );
    expect(
      rendered.root.findByProps({ testID: 'operation-status' }).props.children,
    ).toBe('Saving...');
    expect(
      rendered.root.findByProps({ testID: 'operation-status' }).parent
        ?.children,
    ).toHaveLength(childCount);
    expect(
      rendered.root.findAllByProps({ children: 'Working...' }),
    ).toHaveLength(0);
    expect(
      StyleSheet.flatten(
        rendered.root.findByProps({ testID: 'operation-status' }).props.style,
      ),
    ).toEqual(style);
    await act(async () => {
      rendered.root.findByProps({ label: 'Save' }).props.onPress();
    });
    expect(command.mock.calls.map(([op]) => op)).toEqual([
      'config',
      'status',
      'config.set',
      'config.save',
    ]);
    await act(async () => {
      if (failSave) {
        rejectSave(new Error('Saving failed. Try again.'));
      } else {
        finishSave({
          ...current,
          dirty: false,
          savedRevision: 2,
          savedLedCount: current.requestedLedCount,
          savedRestartRequired: countChanged,
        });
      }
    });
    expect(
      rendered.root.findByProps({ testID: 'operation-status' }).props.children,
    ).toBe(
      failSave
        ? 'Saving failed. Try again.'
        : countChanged
        ? 'Saved. Restart for the LED count only.'
        : 'Saved. No restart needed.',
    );
    expect(
      rendered.root.findByProps({ testID: 'operation-status' }).props
        .accessibilityRole,
    ).toBe('alert');
    expect(rendered.root.findByProps({ label: 'Save' }).props.disabled).toBe(
      false,
    );
    expect(
      rendered.root.findByProps({ testID: 'operation-status' }).parent
        ?.children,
    ).toHaveLength(childCount);
    expect(command.mock.calls.map(([op]) => op)).toEqual([
      'config',
      'status',
      'config.set',
      'config.save',
    ]);
    expect(mockConnect).toHaveBeenCalledTimes(1);
  },
);
