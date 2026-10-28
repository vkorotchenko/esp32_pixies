import { Buffer } from 'buffer';
import { Link, PixiesClient } from '../src/client';
import { frames, HEADER, TIMEOUT } from '../src/protocol';
import { scheduleFixture } from '../testFixtures/schedule';

function fixture(mtu = 23) {
  let receive: (data: Buffer) => void = () => {
    throw new Error('Not subscribed');
  };
  let failed: (error: Error) => void = () => {
    throw new Error('Not subscribed');
  };
  const written: Buffer[] = [];
  const unsubscribe = jest.fn();
  const link: Link = {
    mtu,
    write: jest.fn(async data => {
      written.push(Buffer.from(data));
    }),
    subscribe: (onData, onError) => {
      receive = onData;
      failed = onError;
      return unsubscribe;
    },
  };
  const client = new PixiesClient(link);
  function reply(body: unknown, status = 200, id = written[0].readUInt16LE(2)) {
    frames(
      Buffer.from(JSON.stringify({ status, body })),
      id,
      mtu,
      true,
    ).forEach(receive);
  }
  return {
    client,
    link,
    written,
    reply,
    unsubscribe,
    fail: (error: Error) => failed(error),
  };
}
async function flush() {
  for (let i = 0; i < 200; i++) {
    await Promise.resolve();
  }
}
test('serializes the complete command and waits for the device response', async () => {
  const f = fixture();
  const pending = f.client.command('config.set', {
    baseRevision: 2,
    config: { color: 'fixture' },
  });
  await flush();
  const command = Buffer.concat(
    f.written.map(p => p.subarray(HEADER)),
  ).toString('utf8');
  expect(JSON.parse(command)).toEqual({
    op: 'config.set',
    args: { baseRevision: 2, config: { color: 'fixture' } },
  });
  await expect(f.client.command('status')).rejects.toThrow('still running');
  f.reply({ revision: 3 });
  await expect(pending).resolves.toEqual({ revision: 3 });
  f.client.close();
  expect(f.unsubscribe).toHaveBeenCalledTimes(1);
});
test('schedule save and response cross minimum MTU fragments without lighting replay', async () => {
  const f = fixture(23);
  const saved = scheduleFixture();
  saved.revision = 2;
  const pending = f.client.saveSchedule(saved.bootId, 1, saved.schedule);
  await flush();
  const wire = JSON.parse(
    Buffer.concat(f.written.map(p => p.subarray(HEADER))).toString(),
  );
  expect(wire.op).toBe('schedule.save');
  expect(wire.args).toEqual({
    bootId: saved.bootId,
    baseRevision: 1,
    schedule: saved.schedule,
  });
  expect(f.written.length).toBeGreaterThan(20);
  f.reply(saved);
  await expect(pending).resolves.toEqual(saved);
  f.client.close();
});
test('schedule command limit is smaller than the unchanged transport limit', async () => {
  const f = fixture();
  await expect(
    f.client.command('schedule.save', { oversized: 'x'.repeat(4096) }),
  ).rejects.toThrow('4096');
  expect(f.written).toHaveLength(0);
  f.client.close();
});
test.each(['storage_failed', 'revision_conflict', 'busy'])(
  'propagates %s rather than claiming success',
  async code => {
    const f = fixture(247);
    const pending = f.client.command('config.save', { baseRevision: 1 });
    await flush();
    f.reply({ error: { code, message: 'Fixture failure' } }, 409);
    await expect(pending).rejects.toMatchObject({
      code,
      message: 'Fixture failure',
    });
    f.client.close();
  },
);
test('rejects malformed replies and disconnects', async () => {
  const f = fixture();
  const pending = f.client.command('status');
  await flush();
  f.reply({ ok: true }, 123);
  await expect(pending).rejects.toThrow('Malformed');
  const next = f.client.command('status');
  f.fail(new Error('Link lost'));
  await expect(next).rejects.toThrow('Link lost');
  f.client.close();
  await expect(f.client.command('status')).rejects.toThrow('Connect');
});
test('deadline settles even when a native write never completes; late writes cannot cancel new commands', async () => {
  jest.useFakeTimers();
  const f = fixture();
  let rejectWrite: (error: Error) => void = () => {
    throw new Error('No write');
  };
  f.link.write = jest.fn(
    () =>
      new Promise<void>((_, reject) => {
        rejectWrite = reject;
      }),
  );
  const first = f.client.command('status');
  jest.advanceTimersByTime(TIMEOUT);
  await expect(first).rejects.toThrow('did not reply');
  f.link.write = jest.fn(async data => {
    f.written.push(Buffer.from(data));
  });
  const second = f.client.command('status');
  rejectWrite(new Error('Late native failure'));
  await flush();
  f.reply({ state: 'connected' });
  await expect(second).resolves.toEqual({ state: 'connected' });
  f.client.close();
  jest.useRealTimers();
});
