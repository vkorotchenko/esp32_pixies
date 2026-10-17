import { Buffer } from 'buffer';
import { frames, Receiver, TIMEOUT } from '../src/protocol';

test('matches the firmware wire vector exactly', () => {
  expect([...frames(Buffer.from('{}'), 0x1234, 23, true)[0]]).toEqual([
    1, 1, 0x34, 0x12, 0, 0, 2, 0, 123, 125,
  ]);
});
test.each([23, 185, 247, 517])(
  'reassembles byte-fragmented messages at MTU %i',
  mtu => {
    for (const size of [1, 1024, 8192]) {
      const input = Buffer.alloc(size, 'x');
      const receiver = new Receiver();
      let output: Buffer | null = null;
      frames(input, 5, mtu, true).forEach(packet => {
        output = receiver.push(packet, 5, 100);
      });
      expect(output).toEqual(input);
      receiver.reset();
    }
    const unicode = Buffer.from(
      JSON.stringify({ ssid: '灯泡', message: 'é'.repeat(100) }),
    );
    const receiver = new Receiver();
    let output: Buffer | null = null;
    frames(unicode, 7, mtu, true).forEach(packet => {
      output = receiver.push(packet, 7, 100);
    });
    expect(output).toEqual(unicode);
  },
);
test('rejects invalid length, wrong direction/id, reordered chunks and oversize', () => {
  const packets = frames(Buffer.alloc(100), 8, 23, true);
  expect(() => new Receiver().push(packets[1], 8, 0)).toThrow();
  expect(() => new Receiver().push(packets[0], 9, 0)).toThrow();
  expect(() =>
    new Receiver().push(frames(Buffer.from('{}'), 8, 23)[0], 8, 0),
  ).toThrow();
  expect(() => frames(Buffer.alloc(8193), 8, 23)).toThrow();
  expect(() => frames(Buffer.from('{}'), 8, 22)).toThrow();
  const receiver = new Receiver();
  receiver.push(packets[0], 8, 10);
  expect(() => receiver.push(packets[0], 8, 11)).toThrow();
  expect(() => receiver.push(packets[1], 8, TIMEOUT + 10)).toThrow();
});
