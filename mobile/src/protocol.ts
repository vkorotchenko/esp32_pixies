import { Buffer } from 'buffer';

export const SERVICE = '9a77e401-8c5b-4c3b-908a-6c749f662800';
export const RX = '9a77e402-8c5b-4c3b-908a-6c749f662800';
export const TX = '9a77e403-8c5b-4c3b-908a-6c749f662800';
export const HEADER = 8;
export const MAX_MESSAGE = 8192;
export const TIMEOUT = 30000;

export function frames(
  data: Buffer,
  id: number,
  mtu: number,
  response = false,
): Buffer[] {
  if (
    !Number.isInteger(id) ||
    id < 1 ||
    id > 65535 ||
    !data.length ||
    data.length > MAX_MESSAGE ||
    !Number.isInteger(mtu) ||
    mtu < 23
  ) {
    throw new Error('Invalid Bluetooth message size, transaction, or MTU.');
  }
  const payload = Math.min(mtu - 3, 244) - HEADER;
  const result: Buffer[] = [];
  for (let offset = 0; offset < data.length; offset += payload) {
    const chunk = data.subarray(offset, offset + payload);
    const frame = Buffer.alloc(HEADER + chunk.length);
    frame[0] = 1;
    frame[1] = response ? 1 : 0;
    frame.writeUInt16LE(id, 2);
    frame.writeUInt16LE(offset, 4);
    frame.writeUInt16LE(data.length, 6);
    frame.set(chunk, HEADER);
    result.push(frame);
  }
  return result;
}
export class Receiver {
  private data = Buffer.alloc(MAX_MESSAGE);
  private id = 0;
  private used = 0;
  private total = 0;
  private started = 0;
  reset(): void {
    this.data.fill(0);
    this.id = this.used = this.total = this.started = 0;
  }
  push(frame: Buffer, expectedId: number, now: number): Buffer | null {
    if (this.id && now - this.started >= TIMEOUT) {
      this.reset();
      throw new Error('Bluetooth response timed out.');
    }
    if (
      frame.length <= HEADER ||
      frame.length > 244 ||
      frame[0] !== 1 ||
      frame[1] !== 1 ||
      frame.readUInt16LE(2) !== expectedId
    ) {
      throw new Error('Invalid Bluetooth response frame.');
    }
    const offset = frame.readUInt16LE(4);
    const total = frame.readUInt16LE(6);
    const payload = frame.subarray(HEADER);
    if (
      !total ||
      total > MAX_MESSAGE ||
      offset !== this.used ||
      payload.length > total - offset ||
      (this.id !== 0 && this.total !== total)
    ) {
      throw new Error('Incomplete or out-of-order Bluetooth response.');
    }
    if (!this.id) {
      this.id = expectedId;
      this.total = total;
      this.started = now;
    }
    this.data.set(payload, this.used);
    this.used += payload.length;
    return this.used === total
      ? Buffer.from(this.data.subarray(0, total))
      : null;
  }
}
