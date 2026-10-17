import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, Device, State, Subscription } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import { Link } from './client';
import { RX, SERVICE, TX } from './protocol';

export interface FoundDevice {
  id: string;
  name: string;
  rssi: number | null;
}
export class Bluetooth {
  private manager = new BleManager();
  private device: Device | null = null;
  private disconnect: Subscription | null = null;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private scanCleanup: (() => void) | null = null;
  private connectingId: string | null = null;
  private closing: Promise<void> | null = null;
  private generation = 0;
  private checkCanceled(signal?: AbortSignal) {
    if (signal?.aborted) {
      throw new Error('Bluetooth connection attempt canceled.');
    }
  }
  private async ready(signal?: AbortSignal): Promise<void> {
    this.checkCanceled(signal);
    if (Platform.OS === 'android') {
      const permissions =
        Number(Platform.Version) >= 31
          ? [
              PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
              PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
            ]
          : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
      const results = await PermissionsAndroid.requestMultiple(permissions);
      if (
        !permissions.every(
          p => results[p] === PermissionsAndroid.RESULTS.GRANTED,
        )
      ) {
        throw new Error(
          'Allow Bluetooth permissions in phone settings to find your Pixies.',
        );
      }
    }
    this.checkCanceled(signal);
    const state = await this.manager.state();
    this.checkCanceled(signal);
    if (state !== State.PoweredOn) {
      throw new Error(
        state === State.Unauthorized
          ? 'Allow Bluetooth access in phone settings, then scan again.'
          : 'Turn on Bluetooth and scan again.',
      );
    }
  }
  onPoweredOn(ready: () => void): () => void {
    const subscription = this.manager.onStateChange(state => {
      if (state === State.PoweredOn) {
        ready();
      }
    }, false);
    return () => subscription.remove();
  }
  async scan(
    found: (device: FoundDevice) => void,
    failed: (error: Error) => void,
    ended: () => void,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.stopScan();
    await this.ready(signal);
    let active = true;
    const cancel = () => {
      this.stopScan().then(
        () => failed(new Error('Bluetooth connection attempt canceled.')),
        failed,
      );
    };
    signal?.addEventListener('abort', cancel, { once: true });
    this.scanCleanup = () => {
      active = false;
      signal?.removeEventListener('abort', cancel);
    };
    this.scanTimer = setTimeout(() => {
      this.stopScan().then(ended, failed);
    }, 10000);
    try {
      await this.manager.startDeviceScan([SERVICE], null, (error, device) => {
        if (!active) {
          return;
        }
        if (error) {
          this.stopScan().then(() => failed(new Error(error.message)), failed);
        } else if (device) {
          found({
            id: device.id,
            name: 'pixies',
            rssi: device.rssi,
          });
        }
      });
    } catch (error) {
      await this.stopScan();
      throw error;
    }
  }
  async stopScan(): Promise<void> {
    this.scanCleanup?.();
    this.scanCleanup = null;
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    await this.manager.stopDeviceScan();
  }
  async connect(
    id: string,
    disconnected: (error: Error) => void,
    signal?: AbortSignal,
  ): Promise<Link> {
    if (this.closing) {
      await this.closing;
    }
    await this.stopScan();
    const generation = ++this.generation;
    await this.ready(signal);
    const current = () => {
      this.checkCanceled(signal);
      if (generation !== this.generation) {
        throw new Error('Bluetooth connection attempt was superseded.');
      }
    };
    current();
    this.connectingId = id;
    let cancellation: Promise<void> | null = null;
    const cancel = () => {
      if (generation === this.generation) {
        cancellation = this.close();
        cancellation.catch(error =>
          console.warn('Bluetooth connection cancellation failed:', error),
        );
      }
    };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const connected = await this.manager.connectToDevice(id, {
        requestMTU: 247,
        timeout: 30000,
      });
      current();
      this.device = connected;
      const device = await connected.discoverAllServicesAndCharacteristics();
      current();
      this.device = device;
      this.disconnect = this.manager.onDeviceDisconnected(id, error => {
        if (generation !== this.generation) {
          return;
        }
        this.device = null;
        this.disconnect?.remove();
        this.disconnect = null;
        disconnected(new Error(error?.message || 'Controller disconnected.'));
      });
      return {
        mtu: device.mtu,
        write: async frame => {
          await device.writeCharacteristicWithResponseForService(
            SERVICE,
            RX,
            frame.toString('base64'),
          );
        },
        subscribe: (receive, failed) => {
          const subscription = device.monitorCharacteristicForService(
            SERVICE,
            TX,
            (error, characteristic) => {
              if (error) {
                failed(new Error(error.message));
              } else if (characteristic?.value) {
                receive(Buffer.from(characteristic.value, 'base64'));
              } else {
                failed(
                  new Error(
                    'Controller returned an empty Bluetooth notification.',
                  ),
                );
              }
            },
          );
          return () => subscription.remove();
        },
      };
    } catch (error) {
      if (cancellation) {
        await cancellation;
      } else if (generation === this.generation) {
        await this.close();
      }
      throw error;
    } finally {
      signal?.removeEventListener('abort', cancel);
      if (generation === this.generation) {
        this.connectingId = null;
      }
    }
  }
  close(): Promise<void> {
    if (!this.closing) {
      this.closing = this.closeCurrent().finally(() => {
        this.closing = null;
      });
    }
    return this.closing;
  }
  private async closeCurrent(): Promise<void> {
    ++this.generation;
    await this.stopScan();
    this.disconnect?.remove();
    this.disconnect = null;
    const id = this.device?.id ?? this.connectingId;
    this.device = null;
    this.connectingId = null;
    if (id) {
      await this.manager.cancelDeviceConnection(id);
    }
  }
  async destroy(): Promise<void> {
    try {
      await this.close();
    } finally {
      await this.manager.destroy();
    }
  }
}
