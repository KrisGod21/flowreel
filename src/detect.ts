import { connect } from 'node:net';
import type { Socket } from 'node:net';

// Ports common local dev servers pick by default: Create React App / CRA-style
// tooling and plain Node servers (3000), Vite (5173), webpack-dev-server and a
// lot of Express apps (8080), Angular (4200), and `python -m http.server`
// (8000). This list is deliberately short - it is a first-run convenience,
// not an attempt to enumerate every framework's default.
export const DEFAULT_DEV_PORTS = [3000, 5173, 8080, 4200, 8000];

const DEFAULT_TIMEOUT_MS = 300;

/**
 * Scans localhost for something listening on the given ports, in parallel,
 * each attempt bounded by timeoutMs so a filtered or slow-to-respond port
 * cannot make the whole scan hang. Returns the subset of `ports` that
 * accepted a TCP connection, in the same order they were given.
 *
 * Pure enough to unit-test: start a throwaway `net.createServer()` on an
 * ephemeral port and pass that port in.
 */
export async function detectDevServers(
  ports: number[] = DEFAULT_DEV_PORTS,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<number[]> {
  const open = await Promise.all(ports.map((port) => isPortOpen(port, timeoutMs)));
  return ports.filter((_, index) => open[index]);
}

function isPortOpen(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolveOpen) => {
    let settled = false;
    const socket: Socket = connect({ host: 'localhost', port });

    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolveOpen(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}
