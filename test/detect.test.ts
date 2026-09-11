import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer } from 'node:net';
import type { Server } from 'node:net';
import { EventEmitter } from 'node:events';
import { detectDevServers } from '../src/detect.js';

let server: Server | undefined;

afterEach(async () => {
  if (server) {
    await new Promise((r) => server!.close(() => r(undefined)));
    server = undefined;
  }
  vi.doUnmock('node:net');
  vi.resetModules();
});

function listen(): Promise<number> {
  return new Promise((resolvePort) => {
    server = createServer((socket) => socket.end());
    server.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      resolvePort(typeof address === 'object' && address ? address.port : 0);
    });
  });
}

describe('detectDevServers', () => {
  it('finds a port a test server is listening on', async () => {
    const port = await listen();

    const found = await detectDevServers([port], 300);

    expect(found).toEqual([port]);
  });

  it('ignores a port nothing is listening on', async () => {
    // Bind an ephemeral port then close it immediately, so we have a port
    // number that is (almost certainly) not otherwise in use on this
    // machine, but that nothing answers on.
    const closedPort = await listen();
    await new Promise((r) => server!.close(() => r(undefined)));
    server = undefined;

    const found = await detectDevServers([closedPort], 300);

    expect(found).toEqual([]);
  });

  it('finds one and ignores the other when scanning multiple ports at once', async () => {
    const openPort = await listen();
    const closedPort = openPort === 65534 ? 65533 : 65534;

    const found = await detectDevServers([openPort, closedPort], 300);

    expect(found).toEqual([openPort]);
  });

  it('respects the timeout: a connection attempt that never settles does not hang the scan', async () => {
    // A real closed/refused port on localhost answers almost instantly, so it
    // cannot exercise the timeout path. Mock node:net's `connect` with a fake
    // socket that never emits 'connect' or 'error' - only a real 'timeout' -
    // to prove detectDevServers actually bounds the wait by timeoutMs instead
    // of relying on the remote end to respond.
    vi.resetModules();
    vi.doMock('node:net', () => ({
      connect: () => {
        const fake = new EventEmitter() as EventEmitter & {
          setTimeout: (ms: number) => void;
          destroy: () => void;
        };
        fake.setTimeout = (ms: number) => {
          setTimeout(() => fake.emit('timeout'), ms);
        };
        fake.destroy = () => {};
        return fake;
      },
    }));

    const { detectDevServers: detectWithMock } = await import('../src/detect.js');

    const start = Date.now();
    const result = await detectWithMock([9999], 50);
    const elapsed = Date.now() - start;

    expect(result).toEqual([]);
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(1000);
  });
});
