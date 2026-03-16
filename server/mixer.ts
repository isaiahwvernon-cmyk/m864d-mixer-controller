import net from "net";
import { EventEmitter } from "events";
import { defaultMixerState, type MixerState } from "@shared/schema";

const KEEPALIVE_INTERVAL_MS = 5000;
const RECONNECT_DELAY_MS = 5000;
const POLL_INTERVAL_MS = 30000;
const METER_POLL_INTERVAL_MS = 300;
const SOCKET_TIMEOUT_MS = 30000;

export class MixerManager extends EventEmitter {
  private socket: net.Socket | null = null;
  private state: MixerState = defaultMixerState();
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private meterTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private receiveBuffer: Buffer = Buffer.alloc(0);
  private lastSentAt: number = 0;
  private intentionalDisconnect: boolean = false;
  private connecting: boolean = false;
  private currentIp: string = "";
  private currentPort: number = 3000;

  getState(): MixerState {
    return { ...this.state };
  }

  isConnected(): boolean {
    return this.state.connected;
  }

  connect(ip: string, port: number = 3000): void {
    // Always fully tear down — clears any pending reconnect timer,
    // kills existing socket, and stops keepalive before re-connecting
    this.intentionalDisconnect = true;
    this._cleanup();
    this.intentionalDisconnect = false;
    this.connecting = false;
    this.currentIp = ip;
    this.currentPort = port;
    this.state.ip = ip;
    this.state.port = port;
    this.state.remoteMode = null;
    this._doConnect(ip, port);
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    this._cleanup();
    this.state.connected = false;
    this.emit("state", this.state);
  }

  private _doConnect(ip: string, port: number): void {
    this.connecting = true;
    console.log(`[Mixer] Connecting to ${ip}:${port}...`);

    const sock = new net.Socket();
    this.socket = sock;

    sock.setTimeout(SOCKET_TIMEOUT_MS);

    sock.connect(port, ip, () => {
      console.log(`[Mixer] Connected to ${ip}:${port}`);
      this.connecting = false;
      this.state.connected = true;
      this.receiveBuffer = Buffer.alloc(0);
      this.emit("state", this.state);
      this._startKeepalive();
      setTimeout(() => {
        this._requestAllState();
      }, 500);
    });

    sock.on("data", (data: Buffer) => {
      if (this.socket !== sock) return;
      this.receiveBuffer = Buffer.concat([this.receiveBuffer, data]);
      this._parseBuffer();
    });

    sock.on("timeout", () => {
      if (this.socket !== sock) return;
      this._rawSend(Buffer.from([0xFF]));
      sock.setTimeout(SOCKET_TIMEOUT_MS);
    });

    sock.on("error", (err) => {
      if (this.socket !== sock) return;
      console.log(`[Mixer] Socket error: ${err.message}`);
    });

    sock.on("close", () => {
      // Ignore close events from sockets that have already been replaced
      if (this.socket !== sock) return;
      console.log("[Mixer] Connection closed");
      this.connecting = false;
      this.state.connected = false;
      this.state.remoteMode = null;
      this._cleanup();
      this.emit("state", this.state);
      if (!this.intentionalDisconnect) {
        console.log(`[Mixer] Reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`);
        this.reconnectTimer = setTimeout(() => {
          this._doConnect(this.currentIp, this.currentPort);
        }, RECONNECT_DELAY_MS);
      }
    });
  }

  private _cleanup(): void {
    if (this.keepaliveTimer) { clearInterval(this.keepaliveTimer); this.keepaliveTimer = null; }
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.meterTimer) { clearInterval(this.meterTimer); this.meterTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.socket) {
      const s = this.socket;
      this.socket = null;       // null first so stale-socket guards fire correctly
      try { s.destroy(); } catch {}
    }
  }

  private _startKeepalive(): void {
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = setInterval(() => {
      if (this.state.connected) {
        const idle = Date.now() - this.lastSentAt;
        if (idle >= KEEPALIVE_INTERVAL_MS - 500) {
          this._rawSend(Buffer.from([0xFF]));
        }
      }
    }, KEEPALIVE_INTERVAL_MS);

    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      if (this.state.connected) {
        console.log("[Mixer] Periodic full state poll");
        this._requestAllState();
      }
    }, POLL_INTERVAL_MS);

    // Rapid meter polling so level meters animate smoothly
    if (this.meterTimer) clearInterval(this.meterTimer);
    this.meterTimer = setInterval(() => {
      if (!this.state.connected) return;
      for (let ch = 0; ch < 8; ch++) this.sendCommand([0xE6, 0x03, 0x01, 0x00, ch]);
      for (let ch = 0; ch < 2; ch++) this.sendCommand([0xE6, 0x03, 0x01, 0x01, ch]);
      for (let ch = 0; ch < 4; ch++) this.sendCommand([0xE6, 0x03, 0x01, 0x02, ch]);
    }, METER_POLL_INTERVAL_MS);
  }

  private _rawSend(data: Buffer): void {
    if (this.socket && !this.socket.destroyed && this.state.connected) {
      try {
        this.socket.write(data);
        this.lastSentAt = Date.now();
      } catch (e) {
        console.error("[Mixer] Send error:", e);
      }
    }
  }

  sendCommand(bytes: number[]): void {
    this._rawSend(Buffer.from(bytes));
  }

  // ── Control lock ───────────────────────────────────────────────────────────
  // "View Only" physically disconnects from the mixer (no traffic sent).
  // "Control" reconnects using the last-used IP/port.

  setRemoteMode(remote: boolean): void {
    if (remote) {
      console.log(`[Mixer] Control re-enabled — reconnecting to ${this.currentIp}:${this.currentPort}`);
      this.state.remoteMode = null;
      if (this.currentIp) {
        this.connect(this.currentIp, this.currentPort);
      }
    } else {
      console.log("[Mixer] View-only mode — disconnecting from mixer");
      // Intentional disconnect — no auto-reconnect
      this.intentionalDisconnect = true;
      this._cleanup();
      this.state.connected = false;
      this.state.remoteMode = false;
      // Keep ip/port so the UI still knows what it was connected to
      this.emit("state", this.state);
    }
  }

  // ── State polling ──────────────────────────────────────────────────────────
  requestSync(): void {
    if (!this.state.connected) return;
    console.log("[Mixer] Manual sync requested");
    this._requestAllState();
  }

  private _requestAllState(): void {
    const cmds: number[][] = [];

    cmds.push([0xF2, 0x02, 0x01, 0x01]);
    cmds.push([0xF2, 0x02, 0x00, 0x02]);
    cmds.push([0xF0, 0x02, 0x71, 0x00]);

    for (let ch = 0; ch < 8; ch++) {
      cmds.push([0xF0, 0x03, 0x11, 0x00, ch]);
      cmds.push([0xF0, 0x03, 0x12, 0x00, ch]);
    }
    for (let ch = 0; ch < 2; ch++) {
      cmds.push([0xF0, 0x03, 0x11, 0x01, ch]);
      cmds.push([0xF0, 0x03, 0x12, 0x01, ch]);
    }
    for (let ch = 0; ch < 4; ch++) {
      cmds.push([0xF0, 0x03, 0x11, 0x02, ch]);
      cmds.push([0xF0, 0x03, 0x12, 0x02, ch]);
    }
    for (let ch = 0; ch < 2; ch++) {
      cmds.push([0xF0, 0x03, 0x11, 0x03, ch]);
      cmds.push([0xF0, 0x03, 0x12, 0x03, ch]);
    }

    for (let src = 0; src < 8; src++) {
      for (let bus = 0; bus < 4; bus++) {
        cmds.push([0xF0, 0x04, 0x14, 0x00, src, bus]);
        cmds.push([0xF0, 0x04, 0x15, 0x00, src, bus]);
      }
    }
    for (let src = 0; src < 2; src++) {
      for (let bus = 0; bus < 4; bus++) {
        cmds.push([0xF0, 0x04, 0x14, 0x01, src, bus]);
        cmds.push([0xF0, 0x04, 0x15, 0x01, src, bus]);
      }
    }

    for (let bus = 0; bus < 4; bus++) {
      cmds.push([0xF0, 0x04, 0x16, bus, 0x03, 0x00]);
      cmds.push([0xF0, 0x04, 0x16, bus, 0x03, 0x01]);
    }

    for (let ch = 0; ch < 8; ch++) {
      cmds.push([0xE6, 0x03, 0x01, 0x00, ch]);
    }
    for (let ch = 0; ch < 2; ch++) {
      cmds.push([0xE6, 0x03, 0x01, 0x01, ch]);
    }
    for (let ch = 0; ch < 4; ch++) {
      cmds.push([0xE6, 0x03, 0x01, 0x02, ch]);
    }

    let delay = 0;
    for (const cmd of cmds) {
      setTimeout(() => this.sendCommand(cmd), delay);
      delay += 30;
    }
  }

  // ── Packet parser ──────────────────────────────────────────────────────────
  private _parseBuffer(): void {
    while (this.receiveBuffer.length >= 2) {
      const cmd = this.receiveBuffer[0];
      if (cmd < 0x80) {
        this.receiveBuffer = this.receiveBuffer.slice(1);
        continue;
      }
      if (cmd === 0xFF) {
        this.receiveBuffer = this.receiveBuffer.slice(1);
        continue;
      }
      const dataLen = this.receiveBuffer[1];
      const totalLen = 2 + dataLen;
      if (this.receiveBuffer.length < totalLen) break;

      const packet = this.receiveBuffer.slice(0, totalLen);
      this.receiveBuffer = this.receiveBuffer.slice(totalLen);
      this._handlePacket(cmd, packet.slice(2));
    }
  }

  private _handlePacket(cmd: number, data: Buffer): void {
    let changed = false;

    if (cmd === 0xDF && data.length >= 1 && data[0] === 0x01) {
      console.log("[Mixer] Connection establishment acknowledged");
      return;
    }

    if (cmd === 0xF2) {
      if (data.length >= 1) {
        const subCode = data[0];
        if (subCode === 0x01 && data.length > 1) {
          const name = data.slice(1).toString("ascii").replace(/\0/g, "").trim();
          if (name) console.log(`[Mixer] Machine name: ${name}`);
        } else if (subCode === 0x00 && data.length > 1) {
          const ver = data.slice(1).toString("ascii").replace(/\0/g, "").trim();
          if (ver) console.log(`[Mixer] Firmware: ${ver}`);
        }
      }
      return;
    }

    if (cmd === 0x91 && data.length >= 3) {
      const attr = data[0];
      const ch = data[1];
      const pos = data[2];
      if (attr === 0x00 && ch < 8) { this.state.monoInFader[ch] = pos; changed = true; }
      else if (attr === 0x01 && ch < 2) { this.state.stereoInFader[ch] = pos; changed = true; }
      else if (attr === 0x02 && ch < 4) { this.state.monoOutFader[ch] = pos; changed = true; }
      else if (attr === 0x03 && ch < 2) { this.state.recOutFader[ch] = pos; changed = true; }
    }

    else if (cmd === 0x92 && data.length >= 3) {
      const attr = data[0];
      const ch = data[1];
      const on = data[2] === 0x01;
      if (attr === 0x00 && ch < 8) { this.state.monoInOn[ch] = on; changed = true; }
      else if (attr === 0x01 && ch < 2) { this.state.stereoInOn[ch] = on; changed = true; }
      else if (attr === 0x02 && ch < 4) { this.state.monoOutOn[ch] = on; changed = true; }
      else if (attr === 0x03 && ch < 2) { this.state.recOutOn[ch] = on; changed = true; }
    }

    else if (cmd === 0x94 && data.length >= 4) {
      const srcAttr = data[0];
      const srcCh = data[1];
      const bus = data[2];
      const on = data[3] === 0x01;
      const srcIdx = srcAttr === 0x00 ? srcCh : 8 + srcCh;
      if (srcIdx < 10 && bus < 4) {
        this.state.inputMatrix[srcIdx][bus] = on;
        changed = true;
      }
    }

    else if (cmd === 0x95 && data.length >= 4) {
      const srcAttr = data[0];
      const srcCh = data[1];
      const bus = data[2];
      const val = data[3];
      const srcIdx = srcAttr === 0x00 ? srcCh : 8 + srcCh;
      if (srcIdx < 10 && bus < 4 && val <= 0x46) {
        this.state.inputMatrixGain[srcIdx][bus] = val;
        changed = true;
      }
    }

    else if (cmd === 0x96 && data.length >= 4) {
      const bus = data[0];
      const dstAttr = data[1];
      const dstCh = data[2];
      const on = data[3] === 0x01;
      if (dstAttr === 0x03 && bus < 4 && dstCh < 2) {
        this.state.outputMatrix[bus][dstCh] = on;
        changed = true;
      }
    }

    else if (cmd === 0xF1 && data.length >= 2) {
      this.state.currentPreset = data[1];
      changed = true;
    }

    else if (cmd === 0xE6 && data.length >= 4) {
      const subCmd = data[0];
      if (subCmd === 0x00) {
        const attr = data[1];
        const ch = data[2];
        const level = data[3];
        if (attr === 0x00 && ch < 8) { this.state.monoInLevel[ch] = level; changed = true; }
        else if (attr === 0x01 && ch < 4) { this.state.stereoInLevel[ch] = level; changed = true; }
        else if (attr === 0x02 && ch < 4) { this.state.monoOutLevel[ch] = level; changed = true; }
      }
    }

    if (changed) {
      this.emit("state", this.state);
    }
  }

  // ── Control commands ───────────────────────────────────────────────────────
  setFader(attr: number, ch: number, position: number): void {
    this.sendCommand([0x91, 0x03, attr, ch, position]);
  }

  setOnOff(attr: number, ch: number, on: boolean): void {
    this.sendCommand([0x92, 0x03, attr, ch, on ? 0x01 : 0x00]);
  }

  setInputMatrix(srcAttr: number, srcCh: number, bus: number, on: boolean): void {
    this.sendCommand([0x94, 0x04, srcAttr, srcCh, bus, on ? 0x01 : 0x00]);
  }

  setInputMatrixGain(srcAttr: number, srcCh: number, bus: number, value: number): void {
    this.sendCommand([0x95, 0x04, srcAttr, srcCh, bus, value]);
  }

  setOutputMatrix(bus: number, dstCh: number, on: boolean): void {
    this.sendCommand([0x96, 0x04, bus, 0x03, dstCh, on ? 0x01 : 0x00]);
  }

  loadPreset(presetNum: number): void {
    this.sendCommand([0xF1, 0x02, 0x00, presetNum]);
  }

  storePreset(presetNum: number): void {
    const now = new Date();
    const y = now.getFullYear() - 2000;
    const mo = now.getMonth() + 1;
    const d = now.getDate();
    const h = now.getHours();
    const mi = now.getMinutes();
    const s = now.getSeconds();
    this.sendCommand([0xF3, 0x08, 0x00, presetNum, y, mo, d, h, mi, s]);
  }
}

export const mixer = new MixerManager();
