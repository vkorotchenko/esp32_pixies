import { Buffer } from 'buffer';
import { frames, Receiver, TIMEOUT } from './protocol';
import { record } from './model';
export interface Link {
  mtu: number;
  write(frame: Buffer): Promise<void>;
  subscribe(
    receive: (frame: Buffer) => void,
    failed: (error: Error) => void,
  ): () => void;
}
interface Pending {
  id: number;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}
export class DeviceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}
export class PixiesClient {
  private next = 0;
  private pending: Pending | null = null;
  private receiver = new Receiver();
  private unsubscribe: () => void;
  private closed = false;
  constructor(private link: Link) {
    this.unsubscribe = link.subscribe(
      frame => this.receive(frame),
      error => this.fail(error),
    );
  }
  close(): void {
    this.closed = true;
    this.unsubscribe();
    this.fail(
      new Error(
        'Bluetooth disconnected. Reload device state after reconnecting.',
      ),
    );
  }
  private fail(error: Error): void {
    const pending = this.pending;
    this.pending = null;
    this.receiver.reset();
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
  private receive(frame: Buffer): void {
    if (!this.pending) {
      return;
    }
    // A late response to an already timed-out request cannot satisfy a new one.
    if (frame.length >= 4 && frame.readUInt16LE(2) !== this.pending.id) {
      return;
    }
    try {
      const bytes = this.receiver.push(frame, this.pending.id, Date.now());
      if (!bytes) {
        return;
      }
      const reply: unknown = JSON.parse(bytes.toString('utf8'));
      bytes.fill(0);
      if (
        !record(reply) ||
        typeof reply.status !== 'number' ||
        !Number.isInteger(reply.status) ||
        reply.status < 200 ||
        reply.status > 599 ||
        !record(reply.body)
      ) {
        throw new Error('Malformed Bluetooth command response.');
      }
      if (reply.status >= 300) {
        const error = reply.body.error;
        if (
          !record(error) ||
          typeof error.code !== 'string' ||
          typeof error.message !== 'string'
        ) {
          throw new Error('Malformed Bluetooth error response.');
        }
        throw new DeviceError(error.code, error.message);
      }
      const pending = this.pending;
      this.pending = null;
      this.receiver.reset();
      clearTimeout(pending.timer);
      pending.resolve(reply.body);
    } catch (error) {
      this.fail(
        error instanceof Error
          ? error
          : new Error('Bluetooth response failed.'),
      );
    }
  }
  async command(
    op: string,
    args: Record<string, unknown> = {},
  ): Promise<unknown> {
    if (this.closed) {
      throw new Error('Connect to a Pixies controller first.');
    }
    if (this.pending) {
      throw new Error('Another Bluetooth command is still running.');
    }
    const id = (this.next = (this.next % 65535) + 1);
    const bytes = Buffer.from(
      JSON.stringify({
        op,
        args,
      }),
      'utf8',
    );
    let packets: Buffer[];
    try {
      packets = frames(bytes, id, this.link.mtu);
    } finally {
      bytes.fill(0);
    }
    const response = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.fail(
            new Error(
              'Device did not reply. Reconnect and read state before retrying.',
            ),
          ),
        TIMEOUT,
      );
      this.pending = {
        id,
        resolve,
        reject,
        timer,
      };
    });
    // Attach the rejection consumer before writes, which can outlive a disconnect.
    const result = response.then(
      value => ({
        value,
      }),
      (error: unknown) => ({
        error,
      }),
    );
    const send = async () => {
      try {
        for (const packet of packets) {
          if (this.pending?.id !== id) {
            break;
          }
          await this.link.write(packet);
          packet.fill(0);
        }
      } catch (error) {
        if (this.pending?.id === id) {
          this.fail(
            error instanceof Error
              ? error
              : new Error('Bluetooth write failed.'),
          );
        }
      } finally {
        packets.forEach(packet => packet.fill(0));
      }
    };
    send();
    const settled = await result;
    packets.forEach(packet => packet.fill(0));
    if ('error' in settled) {
      throw settled.error;
    }
    return settled.value;
  }
}
