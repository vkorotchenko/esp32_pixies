import { Dirs, FileSystem } from 'react-native-file-access';
import { record } from './model';

const path = `${Dirs.DocumentDir}/pixies-controller.json`;
const validId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 256 &&
  !/[^\x20-\x7e]/.test(value);

export async function rememberedController(): Promise<string | null> {
  if (!(await FileSystem.exists(path))) {
    return null;
  }
  const info = await FileSystem.stat(path);
  if (info.size > 1024) {
    throw new Error(
      'Saved controller identity is invalid. Choose a controller in Connection.',
    );
  }
  const text = await FileSystem.readFile(path, 'utf8');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    throw new Error(
      'Saved controller identity is invalid. Choose a controller in Connection.',
    );
  }
  if (!record(value) || value.schemaVersion !== 1 || !validId(value.deviceId)) {
    throw new Error(
      'Saved controller identity is invalid. Choose a controller in Connection.',
    );
  }
  return value.deviceId;
}

export async function rememberController(deviceId: string): Promise<void> {
  if (!validId(deviceId)) {
    throw new Error('Cannot remember an invalid Bluetooth device identity.');
  }
  await FileSystem.writeFile(
    path,
    JSON.stringify({ schemaVersion: 1, deviceId }),
    'utf8',
  );
}
