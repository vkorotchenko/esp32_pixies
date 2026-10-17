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
  async scan(
    found: (device: FoundDevice) => void,
    failed: (error: Error) => void,
    ended: () => void,
  ): Promise<void> {
    await this.stopScan();
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
    const state = await this.manager.state();
    if (state !== State.PoweredOn) {
      throw new Error(
        state === State.Unauthorized
          ? 'Allow Bluetooth access in phone settings, then scan again.'
          : 'Turn on Bluetooth and scan again.',
      );
    }
    this.scanTimer = setTimeout(() => {
      this.stopScan().then(ended, failed);
    }, 10000);
    try {
      await this.manager.startDeviceScan([SERVICE], null, (error, device) => {
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
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    await this.manager.stopDeviceScan();
  }
  async connect(
    id: string,
    disconnected: (error: Error) => void,
  ): Promise<Link> {
    await this.stopScan();
    const connected = await this.manager.connectToDevice(id, {
      requestMTU: 247,
      timeout: 30000,
    });
    this.device = connected;
    try {
      const device = await connected.discoverAllServicesAndCharacteristics();
      this.device = device;
      this.disconnect = this.manager.onDeviceDisconnected(id, error => {
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
      await this.close();
      throw error;
    }
  }
  async close(): Promise<void> {
    await this.stopScan();
    this.disconnect?.remove();
    this.disconnect = null;
    const device = this.device;
    this.device = null;
    if (device) {
      await this.manager.cancelDeviceConnection(device.id);
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
