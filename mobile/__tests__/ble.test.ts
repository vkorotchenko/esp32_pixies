import { Platform } from 'react-native';
import { Bluetooth } from '../src/ble';
import { RX, SERVICE, TX } from '../src/protocol';
import { Buffer } from 'buffer';

const mockDevice = {
  id: 'controller',
  mtu: 247,
  discoverAllServicesAndCharacteristics: jest.fn(),
  writeCharacteristicWithResponseForService: jest.fn(),
  monitorCharacteristicForService: jest.fn(),
};
const mockRemove = jest.fn();
const mockRequestMultiple = jest.fn();
const mockManager = {
  state: jest.fn(),
  startDeviceScan: jest.fn(),
  stopDeviceScan: jest.fn(),
  connectToDevice: jest.fn(),
  onDeviceDisconnected: jest.fn(),
  cancelDeviceConnection: jest.fn(),
  destroy: jest.fn(),
};
jest.mock('react-native-ble-plx', () => ({
  BleManager: jest.fn(() => mockManager),
  State: {
    PoweredOn: 'PoweredOn',
    PoweredOff: 'PoweredOff',
    Unauthorized: 'Unauthorized',
  },
}));
jest.mock('react-native', () => ({
  Platform: { OS: 'android', Version: 34 },
  PermissionsAndroid: {
    PERMISSIONS: {
      BLUETOOTH_SCAN: 'scan',
      BLUETOOTH_CONNECT: 'connect',
      ACCESS_FINE_LOCATION: 'location',
    },
    RESULTS: { GRANTED: 'granted' },
    requestMultiple: (...args: unknown[]) => mockRequestMultiple(...args),
  },
}));

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', {
    value: 'android',
    configurable: true,
  });
  Object.defineProperty(Platform, 'Version', { value: 34, configurable: true });
  mockRequestMultiple.mockResolvedValue({
    scan: 'granted',
    connect: 'granted',
    location: 'granted',
  });
  mockManager.state.mockResolvedValue('PoweredOn');
  mockManager.startDeviceScan.mockResolvedValue(undefined);
  mockManager.stopDeviceScan.mockResolvedValue(undefined);
  mockManager.connectToDevice.mockResolvedValue(mockDevice);
  mockManager.onDeviceDisconnected.mockReturnValue({ remove: mockRemove });
  mockManager.cancelDeviceConnection.mockResolvedValue(mockDevice);
  mockManager.destroy.mockResolvedValue(undefined);
  mockDevice.discoverAllServicesAndCharacteristics.mockResolvedValue(
    mockDevice,
  );
  mockDevice.monitorCharacteristicForService.mockReturnValue({
    remove: mockRemove,
  });
  mockDevice.writeCharacteristicWithResponseForService.mockResolvedValue(
    undefined,
  );
});
afterEach(() => jest.useRealTimers());

test('Android 12+ asks only for scan/connect and scans by the Pixies service', async () => {
  const bluetooth = new Bluetooth();
  const found = jest.fn(),
    failed = jest.fn(),
    ended = jest.fn();
  await bluetooth.scan(found, failed, ended);
  expect(mockRequestMultiple).toHaveBeenCalledWith(['scan', 'connect']);
  expect(mockManager.startDeviceScan).toHaveBeenCalledWith(
    [SERVICE],
    null,
    expect.any(Function),
  );
  const callback = mockManager.startDeviceScan.mock.calls[0][2];
  callback(null, { id: 'controller', localName: 'Pixies-0123456789ab', name: 'Cached old name', rssi: -55 });
  expect(found).toHaveBeenCalledWith({
    id: 'controller',
    name: 'pixies',
    rssi: -55,
  });
  await jest.advanceTimersByTimeAsync(10000);
  expect(ended).toHaveBeenCalledTimes(1);
  expect(failed).not.toHaveBeenCalled();
});

test('older Android requests location, while iOS uses its native Bluetooth permission', async () => {
  Object.defineProperty(Platform, 'Version', { value: 30 });
  const bluetooth = new Bluetooth();
  await bluetooth.scan(jest.fn(), jest.fn(), jest.fn());
  expect(mockRequestMultiple).toHaveBeenLastCalledWith(['location']);
  mockRequestMultiple.mockClear();
  Object.defineProperty(Platform, 'OS', { value: 'ios' });
  await bluetooth.scan(jest.fn(), jest.fn(), jest.fn());
  expect(mockRequestMultiple).not.toHaveBeenCalled();
  await bluetooth.stopScan();
});

test('permission denial prevents native scanning', async () => {
  mockRequestMultiple.mockResolvedValue({});
  await expect(
    new Bluetooth().scan(jest.fn(), jest.fn(), jest.fn()),
  ).rejects.toThrow('Allow Bluetooth permissions');
  expect(mockManager.startDeviceScan).not.toHaveBeenCalled();
});

test.each([
  ['PoweredOff', 'Turn on Bluetooth'],
  ['Unauthorized', 'Allow Bluetooth access'],
])('Bluetooth state %s is an explicit error', async (state, message) => {
  mockManager.state.mockResolvedValue(state);
  await expect(
    new Bluetooth().scan(jest.fn(), jest.fn(), jest.fn()),
  ).rejects.toThrow(message);
  expect(mockManager.startDeviceScan).not.toHaveBeenCalled();
});

test('native scan startup rejection cancels its deadline and reaches the caller', async () => {
  const ended = jest.fn();
  mockManager.startDeviceScan.mockRejectedValue(new Error('Scan refused'));
  await expect(
    new Bluetooth().scan(jest.fn(), jest.fn(), ended),
  ).rejects.toThrow('Scan refused');
  await jest.advanceTimersByTimeAsync(10000);
  expect(ended).not.toHaveBeenCalled();
});

test('scan callbacks and asynchronous stop errors are surfaced, not unhandled', async () => {
  const bluetooth = new Bluetooth();
  const failed = jest.fn();
  await bluetooth.scan(jest.fn(), failed, jest.fn());
  mockManager.startDeviceScan.mock.calls[0][2](new Error('Radio failed'), null);
  await jest.advanceTimersByTimeAsync(0);
  expect(failed).toHaveBeenLastCalledWith(
    expect.objectContaining({ message: 'Radio failed' }),
  );
  await bluetooth.scan(jest.fn(), failed, jest.fn());
  mockManager.stopDeviceScan.mockRejectedValueOnce(new Error('Stop failed'));
  await jest.advanceTimersByTimeAsync(10000);
  expect(failed).toHaveBeenLastCalledWith(
    expect.objectContaining({ message: 'Stop failed' }),
  );
});

test('discovery failure cancels the native connection and rejects explicitly', async () => {
  mockDevice.discoverAllServicesAndCharacteristics.mockRejectedValue(
    new Error('Discovery failed'),
  );
  await expect(
    new Bluetooth().connect('controller', jest.fn()),
  ).rejects.toThrow('Discovery failed');
  expect(mockManager.cancelDeviceConnection).toHaveBeenCalledWith('controller');
});

test('the native link carries framed bytes, handles notifications, and reports disconnects', async () => {
  const bluetooth = new Bluetooth();
  const disconnected = jest.fn();
  const link = await bluetooth.connect('controller', disconnected);
  expect(mockManager.connectToDevice).toHaveBeenCalledWith('controller', {
    requestMTU: 247,
    timeout: 30000,
  });
  expect(link.mtu).toBe(247);
  await link.write(Buffer.from([1, 2]));
  expect(
    mockDevice.writeCharacteristicWithResponseForService,
  ).toHaveBeenCalledWith(SERVICE, RX, 'AQI=');
  const receive = jest.fn(),
    failed = jest.fn();
  const remove = link.subscribe(receive, failed);
  expect(mockDevice.monitorCharacteristicForService).toHaveBeenCalledWith(
    SERVICE,
    TX,
    expect.any(Function),
  );
  const callback = mockDevice.monitorCharacteristicForService.mock.calls[0][2];
  callback(null, { value: 'AQI=' });
  expect(receive).toHaveBeenCalledWith(Buffer.from([1, 2]));
  callback(new Error('Pairing cancelled'), null);
  expect(failed).toHaveBeenCalledWith(
    expect.objectContaining({ message: 'Pairing cancelled' }),
  );
  callback(null, {});
  expect(failed).toHaveBeenCalledWith(
    expect.objectContaining({
      message: 'Controller returned an empty Bluetooth notification.',
    }),
  );
  remove();
  mockManager.onDeviceDisconnected.mock.calls[0][1](null);
  expect(disconnected).toHaveBeenCalledWith(
    expect.objectContaining({ message: 'Controller disconnected.' }),
  );
  await bluetooth.close();
  expect(mockManager.cancelDeviceConnection).not.toHaveBeenCalled();
});

test('close removes listeners and destroy awaits and propagates native failures', async () => {
  const bluetooth = new Bluetooth();
  await bluetooth.connect('controller', jest.fn());
  await bluetooth.close();
  expect(mockRemove).toHaveBeenCalled();
  expect(mockManager.cancelDeviceConnection).toHaveBeenCalledTimes(1);
  mockManager.destroy.mockRejectedValueOnce(
    new Error('Native teardown failed'),
  );
  await expect(bluetooth.destroy()).rejects.toThrow('Native teardown failed');
});
