'use strict';
// Synthetic-only socket seam: native https.request and HTTP response parsing stay intact.
const https = require('node:https');
const tls = require('node:tls');
const net = require('node:net');
const { Duplex } = require('node:stream');
const { STATUS_CODES } = require('node:http');

function installSocketFixture({ plans = [], onRequest } = {}) {
  const originals = {
    tlsConnect: tls.connect, createConnection: https.Agent.prototype.createConnection,
    netConnect: net.connect, netCreate: net.createConnection, socketConnect: net.Socket.prototype.connect,
    request: https.request,
  };
  const requests = [], sockets = [], events = [], timers = new Set(), queue = [...plans];
  let active = 0, maxActive = 0, restored = false, fallbackAttempts = 0;
  const later = (fn, ms = 0) => {
    const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms);
    timers.add(timer);
  };
  const blocked = () => { fallbackAttempts++; throw new Error('SYNTHETIC_NETWORK_FALLBACK_PROHIBITED'); };

  class SyntheticSocket extends Duplex {
    constructor(options, plan) {
      super({ allowHalfOpen: false, autoDestroy: true, emitClose: true });
      this.encrypted = true;
      this.authorized = true;
      this.connecting = false;
      this.pending = false;
      this.remoteAddress = '127.0.0.1';
      this.remotePort = 443;
      this.localAddress = '127.0.0.1';
      this.localPort = 0;
      this.plan = plan;
      this.header = Buffer.alloc(0);
      this.bodyParts = [];
      this.bodyLength = 0;
      this.expectedLength = null;
      this.requestReady = false;
      this.responseSent = false;
      this.closeReleased = false;
      this.pendingDestroy = null;
      this.record = {
        index: requests.length,
        options: Object.freeze({ hostname: String(options.hostname || options.host || ''),
          port: Number(options.port || 443), servername: String(options.servername || ''),
          rejectUnauthorized: options.rejectUnauthorized, agentIsFalse: options.agent === false }),
        method: null, path: null, body: null, bodyBytes: 0, closed: false,
      };
      requests.push(this.record);
      sockets.push(this);
      active++;
      maxActive = Math.max(maxActive, active);
      events.push({ event: 'start', index: this.record.index });
      this.once('close', () => {
        this.record.closed = true;
        active--;
        events.push({ event: 'close', index: this.record.index });
      });
      // ClientRequest owns its own error handling. This listener prevents a fixture
      // reset after request teardown from becoming an uncaught EventEmitter error.
      this.on('error', () => {});
    }
    _read() {}
    setNoDelay() { return this; }
    setKeepAlive() { return this; }
    setTimeout(ms, fn) { this.timeout = ms; if (fn) this.once('timeout', fn); return this; }
    address() { return { address: this.localAddress, family: 'IPv4', port: this.localPort }; }
    _write(chunk, _encoding, callback) {
      try {
        let bytes = Buffer.from(chunk);
        if (this.expectedLength === null) {
          this.header = Buffer.concat([this.header, bytes]);
          if (this.header.length > 65536) throw new Error('SYNTHETIC_REQUEST_HEADER_BOUND');
          const at = this.header.indexOf('\r\n\r\n');
          if (at < 0) { callback(); return; }
          // Headers are transient parser input only: never retained in records,
          // callbacks, diagnostics, assertions, or error messages.
          const head = this.header.subarray(0, at).toString('latin1');
          const first = /^([A-Z]+) ([^ ]+) HTTP\/1\.1\r?$/m.exec(head);
          if (!first || /\r\ntransfer-encoding:/i.test(head)) throw new Error('SYNTHETIC_REQUEST_FORMAT');
          this.record.method = first[1];
          this.record.path = first[2].split('?')[0];
          const length = /\r\ncontent-length:\s*(\d+)\s*(?:\r\n|$)/i.exec(head);
          this.expectedLength = length ? Number(length[1]) : 0;
          if (!Number.isSafeInteger(this.expectedLength) || this.expectedLength > 65536) throw new Error('SYNTHETIC_REQUEST_BODY_BOUND');
          bytes = this.header.subarray(at + 4);
          this.header = Buffer.alloc(0);
        }
        this.bodyLength += bytes.length;
        if (this.bodyLength > this.expectedLength) throw new Error('SYNTHETIC_REQUEST_BODY_LENGTH');
        if (bytes.length) this.bodyParts.push(Buffer.from(bytes));
        if (!this.requestReady && this.bodyLength === this.expectedLength) {
          this.requestReady = true;
          const body = Buffer.concat(this.bodyParts);
          this.bodyParts = [];
          this.record.bodyBytes = body.length;
          this.record.body = body.length ? JSON.parse(body.toString('utf8')) : null;
          events.push({ event: 'request', index: this.record.index });
          // A later turn guarantees real ClientRequest socket/parser installation
          // and caller event listeners finish before a synthetic response arrives.
          later(() => {
            if (this.destroyed) return;
            try {
              if (onRequest) onRequest(this.record, controls(this.record.index));
              if (this.plan.reset) reset(this.record.index, this.plan.reset);
              else if (!this.plan.manual && !this.responseSent) respond(this.record.index, this.plan);
            } catch {
              this.destroy(Object.assign(new Error('Synthetic fixture handler failed'), { code: 'SYNTHETIC_REQUEST_HANDLER_FAILED' }));
            }
          }, this.plan.delayResponseMs || 0);
        }
        callback();
      } catch (error) { callback(error); }
    }
    _destroy(error, callback) {
      this.header = Buffer.alloc(0);
      this.bodyParts = [];
      this.pendingDestroy = () => { this.pendingDestroy = null; callback(error); };
      if (this.plan.holdClose && !this.closeReleased) return;
      if (this.plan.closeDelayMs && !this.closeReleased) later(() => this.pendingDestroy?.(), this.plan.closeDelayMs);
      else this.pendingDestroy();
    }
  }

  function createSocket(options = {}, callback) {
    if (restored) throw new Error('SYNTHETIC_FIXTURE_CLOSED');
    if (typeof options !== 'object') throw new Error('SYNTHETIC_TLS_OPTIONS_REQUIRED');
    const socket = new SyntheticSocket(options, queue.shift() || {});
    if (typeof callback === 'function') socket.once('secureConnect', callback);
    process.nextTick(() => { if (!socket.destroyed) { socket.emit('connect'); socket.emit('secureConnect'); } });
    return socket;
  }
  function select(index) {
    const socket = sockets[index];
    if (!socket) throw new Error('SYNTHETIC_SOCKET_NOT_FOUND');
    return socket;
  }
  function respond(index, spec = {}) {
    const socket = select(index);
    if (socket.destroyed || socket.responseSent) throw new Error('SYNTHETIC_RESPONSE_ALREADY_FINISHED');
    socket.responseSent = true;
    const status = spec.statusCode || 200;
    const body = Buffer.isBuffer(spec.body) ? spec.body : Buffer.from(typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body === undefined ? { data: [] } : spec.body));
    const headers = { 'Content-Type': 'application/json', 'Content-Length': body.length, Connection: 'close', ...spec.headers };
    for (const [name, value] of Object.entries(headers)) {
      if (!/^[A-Za-z0-9-]+$/.test(name) || /[\r\n]/.test(String(value))) throw new Error('SYNTHETIC_RESPONSE_HEADER_FORMAT');
    }
    socket.push(Buffer.from(`HTTP/1.1 ${status} ${STATUS_CODES[status] || 'Synthetic'}\r\n${Object.entries(headers).map(([name, value]) => `${name}: ${value}\r\n`).join('')}\r\n`, 'latin1'));
    if (!spec.headersOnly) {
      for (const part of spec.chunks || [body]) socket.push(Buffer.from(part));
      if (spec.end !== false) socket.push(null);
    }
    events.push({ event: 'response', index, status });
  }
  function reset(index, code = 'ECONNRESET') {
    const error = Object.assign(new Error('Synthetic socket reset'), { code });
    select(index).destroy(error);
  }
  function releaseClose(index) {
    const socket = select(index);
    socket.closeReleased = true;
    socket.pendingDestroy?.();
  }
  function controls(index) { return Object.freeze({ respond: spec => respond(index, spec), reset: code => reset(index, code), releaseClose: () => releaseClose(index) }); }
  const interceptedTls = (options, callback) => createSocket(options, callback);
  const interceptedAgent = function (options) { return tls.connect(options); };
  tls.connect = interceptedTls;
  https.Agent.prototype.createConnection = interceptedAgent;
  net.connect = blocked;
  net.createConnection = blocked;
  net.Socket.prototype.connect = blocked;

  async function restore() {
    if (restored) return;
    restored = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    const closes = sockets.filter(socket => !socket.record.closed).map(socket => new Promise(resolve => {
      socket.once('close', resolve);
      socket.closeReleased = true;
      socket.destroy();
      socket.pendingDestroy?.();
    }));
    await Promise.all(closes);
    tls.connect = originals.tlsConnect;
    https.Agent.prototype.createConnection = originals.createConnection;
    net.connect = originals.netConnect;
    net.createConnection = originals.netCreate;
    net.Socket.prototype.connect = originals.socketConnect;
    if (https.request !== originals.request) throw new Error('NATIVE_HTTPS_REQUEST_CHANGED');
  }
  return Object.freeze({ requests, sockets, events, respond, reset, releaseClose, restore,
    enqueue: plan => queue.push(plan),
    snapshot: () => Object.freeze({ starts: requests.length, active, maxActive, fallbackAttempts }),
  });
}

module.exports = { installSocketFixture };
