// A tiny, dependency-free stand-in for the Orion Cloud relay, implementing the
// three endpoints of docs/remote-control-relay.md "Relay wire protocol":
//
//   GET /v1/host?ticket=          host control socket (dial + ping/pong)
//   GET /v1/connect?ticket=&machine=   controller data socket
//   GET /v1/stream?ticket=&stream=     host data socket for one dial
//
// It is a byte pipe and nothing more: once two sockets are joined it forwards
// binary frames verbatim, in order, without interpreting them. It also records
// every byte it forwards, which is what lets the test assert that the relay
// never sees plaintext.
//
// Tickets here are unsigned base64url JSON — the real relay verifies an HMAC
// with ORION_DESKTOP_AUTH_SECRET. The desktop never verifies a ticket, so the
// difference is invisible to the code under test.
//
// The WebSocket framing below is a minimal RFC 6455 server: enough for the
// client Node/Electron ships (no extensions negotiated, no compression), which
// is all this needs to be. `ws` is deliberately not a dependency of this app.
import crypto from 'node:crypto';
import http from 'node:http';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OP_CONTINUATION = 0x0;
const OP_TEXT = 0x1;
const OP_BINARY = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

const encodeFrame = (opcode, payload) => {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65_536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
};

/** Incremental RFC 6455 frame reader; reassembles fragmented messages. */
const createFrameReader = (onMessage, onControl) => {
  let buffer = Buffer.alloc(0);
  let fragmentOpcode = null;
  let fragments = [];
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 2) return;
      const fin = (buffer[0] & 0x80) !== 0;
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < offset + 2) return;
        length = buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (buffer.length < offset + 8) return;
        length = Number(buffer.readBigUInt64BE(offset));
        offset += 8;
      }
      let mask = null;
      if (masked) {
        if (buffer.length < offset + 4) return;
        mask = buffer.subarray(offset, offset + 4);
        offset += 4;
      }
      if (buffer.length < offset + length) return;
      const payload = Buffer.from(buffer.subarray(offset, offset + length));
      if (mask) {
        for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
      }
      buffer = buffer.subarray(offset + length);

      if (opcode === OP_CLOSE || opcode === OP_PING || opcode === OP_PONG) {
        onControl(opcode, payload);
        continue;
      }
      if (opcode === OP_CONTINUATION) {
        fragments.push(payload);
      } else {
        fragmentOpcode = opcode;
        fragments = [payload];
      }
      if (fin) {
        onMessage(fragmentOpcode, Buffer.concat(fragments));
        fragmentOpcode = null;
        fragments = [];
      }
    }
  };
};

const decodeTicket = (value) => {
  try {
    const parsed = JSON.parse(Buffer.from(String(value ?? ''), 'base64url').toString('utf-8'));
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.sub !== 'string' || typeof parsed.machineId !== 'string') return null;
    if (parsed.role !== 'host' && parsed.role !== 'controller') return null;
    if (!Number.isFinite(parsed.exp) || parsed.exp <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
};

/**
 * @param {{ pingIntervalMs?: number, dialTimeoutMs?: number }} options
 */
export const startFakeRelay = async ({ pingIntervalMs = 30_000, dialTimeoutMs = 10_000 } = {}) => {
  const hosts = new Map(); // machineId -> { connection, ownerId, dials: Map }
  const sockets = new Set();
  const stats = {
    upgrades: 0,
    hostSockets: 0,
    connects: 0,
    streams: 0,
    spliced: 0,
    pongs: 0,
    rejected: [],
  };
  const forwarded = []; // every byte the relay carried, for the plaintext check

  const server = http.createServer((_request, response) => {
    response.writeHead(404).end();
  });

  const accept = (request, socket) => {
    const key = request.headers['sec-websocket-key'];
    const acceptKey = crypto
      .createHash('sha1')
      .update(`${key}${WS_GUID}`)
      .digest('base64');
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey}`,
        '\r\n',
      ].join('\r\n')
    );
    socket.setNoDelay(true);
    sockets.add(socket);

    const connection = {
      socket,
      closed: false,
      onClose: null,
      send(opcode, payload) {
        if (connection.closed || socket.destroyed) return;
        socket.write(encodeFrame(opcode, payload));
      },
      sendJson(value) {
        connection.send(OP_TEXT, Buffer.from(JSON.stringify(value), 'utf-8'));
      },
      close(code = 1000) {
        if (connection.closed) return;
        connection.closed = true;
        const payload = Buffer.alloc(2);
        payload.writeUInt16BE(code);
        try {
          socket.write(encodeFrame(OP_CLOSE, payload));
        } catch {}
        socket.end();
        setTimeout(() => socket.destroy(), 200).unref?.();
      },
    };

    // A controller starts writing the instant its socket opens, which is
    // before the host has joined the dial and before the splice exists. Those
    // bytes are the relay's to hold: the contract promises it forwards
    // whatever it receives, in order. Queue until a handler is installed.
    let messageHandler = null;
    const queued = [];
    Object.defineProperty(connection, 'onMessage', {
      get: () => messageHandler,
      set: (handler) => {
        messageHandler = handler;
        while (handler && queued.length > 0) handler(...queued.shift());
      },
    });

    const read = createFrameReader(
      (opcode, payload) => {
        if (messageHandler) messageHandler(opcode, payload);
        else queued.push([opcode, payload]);
      },
      (opcode, payload) => {
        if (opcode === OP_PING) connection.send(OP_PONG, payload);
        if (opcode === OP_CLOSE) {
          connection.closed = true;
          socket.end();
        }
      }
    );
    socket.on('data', (chunk) => {
      try {
        read(chunk);
      } catch {
        socket.destroy();
      }
    });
    let notified = false;
    const notifyClose = () => {
      if (notified) return;
      notified = true;
      connection.closed = true;
      sockets.delete(socket);
      connection.onClose?.();
    };
    socket.on('close', notifyClose);
    socket.on('error', notifyClose);
    return connection;
  };

  const splice = (a, b) => {
    stats.spliced += 1;
    const pipe = (from, to, label) => {
      from.onMessage = (opcode, payload) => {
        if (opcode !== OP_BINARY) return;
        forwarded.push({ label, bytes: Buffer.from(payload) });
        to.send(OP_BINARY, payload);
      };
      from.onClose = () => to.close(1000);
    };
    pipe(a, b, 'controller->host');
    pipe(b, a, 'host->controller');
  };

  server.on('upgrade', (request, socket) => {
    stats.upgrades += 1;
    const url = new URL(request.url, 'http://relay.invalid');
    const ticket = decodeTicket(url.searchParams.get('ticket'));

    if (url.pathname === '/v1/host') {
      if (!ticket || ticket.role !== 'host') {
        stats.rejected.push({ path: url.pathname, code: 4401 });
        accept(request, socket).close(4401);
        return;
      }
      const connection = accept(request, socket);
      stats.hostSockets += 1;
      const entry = { connection, ownerId: ticket.sub, dials: new Map() };
      hosts.set(ticket.machineId, entry);
      const pinger = setInterval(() => connection.sendJson({ t: 'ping' }), pingIntervalMs);
      pinger.unref?.();
      connection.onMessage = (opcode, payload) => {
        if (opcode !== OP_TEXT) return;
        try {
          if (JSON.parse(payload.toString('utf-8'))?.t === 'pong') stats.pongs += 1;
        } catch {}
      };
      connection.onClose = () => {
        clearInterval(pinger);
        if (hosts.get(ticket.machineId) === entry) hosts.delete(ticket.machineId);
        for (const dial of entry.dials.values()) {
          clearTimeout(dial.timer);
          dial.controller.close(4404);
        }
        entry.dials.clear();
      };
      return;
    }

    if (url.pathname === '/v1/connect') {
      stats.connects += 1;
      const machineId = url.searchParams.get('machine') ?? '';
      const connection = accept(request, socket);
      if (!ticket || ticket.role !== 'controller' || ticket.machineId !== machineId) {
        stats.rejected.push({ path: url.pathname, code: 4401 });
        connection.close(4401);
        return;
      }
      const entry = hosts.get(machineId);
      if (!entry || entry.ownerId !== ticket.sub) {
        stats.rejected.push({ path: url.pathname, code: 4404 });
        connection.close(4404);
        return;
      }
      const streamId = crypto.randomUUID();
      const timer = setTimeout(() => {
        entry.dials.delete(streamId);
        stats.rejected.push({ path: url.pathname, code: 4408 });
        connection.close(4408);
      }, dialTimeoutMs);
      timer.unref?.();
      entry.dials.set(streamId, { controller: connection, timer });
      connection.onClose = () => {
        const dial = entry.dials.get(streamId);
        if (!dial) return;
        clearTimeout(dial.timer);
        entry.dials.delete(streamId);
      };
      entry.connection.sendJson({ t: 'dial', streamId });
      return;
    }

    if (url.pathname === '/v1/stream') {
      stats.streams += 1;
      const streamId = url.searchParams.get('stream') ?? '';
      const connection = accept(request, socket);
      if (!ticket || ticket.role !== 'host') {
        stats.rejected.push({ path: url.pathname, code: 4401 });
        connection.close(4401);
        return;
      }
      const entry = hosts.get(ticket.machineId);
      const dial = entry?.dials.get(streamId);
      // Single use, and only for an outstanding dial on this machine.
      if (!entry || entry.ownerId !== ticket.sub || !dial) {
        stats.rejected.push({ path: url.pathname, code: 4401 });
        connection.close(4401);
        return;
      }
      clearTimeout(dial.timer);
      entry.dials.delete(streamId);
      dial.controller.onClose = null;
      splice(dial.controller, connection);
      return;
    }

    accept(request, socket).close(4404);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    url: `ws://127.0.0.1:${port}`,
    stats,
    forwarded,
    hostCount: () => hosts.size,
    /** Drop every live socket without closing the listener (relay restart). */
    dropAll() {
      for (const socket of [...sockets]) socket.destroy();
      sockets.clear();
      hosts.clear();
    },
    async stop() {
      for (const socket of [...sockets]) socket.destroy();
      sockets.clear();
      hosts.clear();
      await new Promise((resolve) => server.close(resolve));
    },
  };
};
