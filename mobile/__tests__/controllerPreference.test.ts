import { FileSystem } from 'react-native-file-access';
import {
  rememberedController,
  rememberController,
} from '../src/controllerPreference';

jest.mock('react-native-file-access', () => ({
  Dirs: { DocumentDir: '/private' },
  FileSystem: {
    exists: jest.fn(),
    stat: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
  },
}));
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(FileSystem.exists).mockResolvedValue(false);
  jest.mocked(FileSystem.stat).mockResolvedValue({
    filename: 'pixies-controller.json',
    lastModified: 1,
    path: '/private/pixies-controller.json',
    size: 80,
    type: 'file',
  });
  jest.mocked(FileSystem.writeFile).mockResolvedValue(undefined);
});
test('a missing preference is first use, not an invented controller', async () => {
  await expect(rememberedController()).resolves.toBeNull();
  expect(FileSystem.readFile).not.toHaveBeenCalled();
});
test('remembers and restores the opaque native device ID, never the shared name', async () => {
  await rememberController('native-controller-id');
  expect(FileSystem.writeFile).toHaveBeenCalledWith(
    '/private/pixies-controller.json',
    '{"schemaVersion":1,"deviceId":"native-controller-id"}',
    'utf8',
  );
  jest.mocked(FileSystem.exists).mockResolvedValue(true);
  jest
    .mocked(FileSystem.readFile)
    .mockResolvedValue('{"schemaVersion":1,"deviceId":"native-controller-id"}');
  await expect(rememberedController()).resolves.toBe('native-controller-id');
});
test.each([
  '{}',
  '{"schemaVersion":2,"deviceId":"id"}',
  '{"schemaVersion":1,"deviceId":""}',
  'not JSON',
])(
  'corrupt preferences are errors, never first-use auto-selection: %s',
  async text => {
    jest.mocked(FileSystem.exists).mockResolvedValue(true);
    jest.mocked(FileSystem.readFile).mockResolvedValue(text);
    await expect(rememberedController()).rejects.toThrow();
  },
);
test('storage failures reach the caller instead of pretending reconnection was remembered', async () => {
  jest
    .mocked(FileSystem.writeFile)
    .mockRejectedValue(new Error('Storage unavailable'));
  await expect(rememberController('native-controller-id')).rejects.toThrow(
    'Storage unavailable',
  );
});
