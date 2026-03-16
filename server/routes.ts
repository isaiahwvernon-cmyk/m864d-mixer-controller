import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { mixer } from "./mixer";
import { mixerConfigSchema } from "@shared/schema";
import { z } from "zod";
import fs from "fs";
import path from "path";
import os from "os";

const CONFIG_PATH = path.resolve(process.cwd(), "mixer-config.json");

function readConfig(): { ip: string; port: number } | null {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function writeConfig(cfg: { ip: string; port: number }): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");
}

function getLanIP(): string {
  const nets = os.networkInterfaces();
  let lanIP = "localhost";
  for (const name of Object.keys(nets)) {
    if (
      name.toLowerCase().includes("vethernet") ||
      name.toLowerCase().includes("wsl") ||
      name.toLowerCase().includes("docker") ||
      name.toLowerCase().includes("vpn")
    ) continue;
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) lanIP = net.address;
    }
  }
  return lanIP;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
  lanIP: string,
  port: number
): Promise<Server> {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  function broadcast(data: object): void {
    const msg = JSON.stringify(data);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  }

  mixer.on("state", (state) => {
    broadcast({ type: "state", state });
  });

  wss.on("connection", (ws) => {
    const state = mixer.getState();
    ws.send(JSON.stringify({ type: "state", state }));
  });

  app.get("/api/info", (_req, res) => {
    res.json({
      lanIP,
      port,
      url: `http://${lanIP}:${port}`,
    });
  });

  app.get("/api/config", (_req, res) => {
    const cfg = readConfig();
    res.json(cfg || { ip: "", port: 3000 });
  });

  app.post("/api/config", (req, res) => {
    const parsed = mixerConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid config", details: parsed.error.issues });
    }
    writeConfig(parsed.data);
    res.json({ ok: true });
  });

  app.get("/api/state", (_req, res) => {
    res.json(mixer.getState());
  });

  app.post("/api/connect", (req, res) => {
    const parsed = mixerConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid config", details: parsed.error.issues });
    }
    const { ip, port: mixerPort } = parsed.data;
    writeConfig({ ip, port: mixerPort });
    mixer.connect(ip, mixerPort);
    res.json({ ok: true, message: `Connecting to ${ip}:${mixerPort}` });
  });

  app.post("/api/disconnect", (_req, res) => {
    mixer.disconnect();
    res.json({ ok: true });
  });

  app.post("/api/remote", (req, res) => {
    const schema = z.object({ remote: z.boolean() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Expected { remote: boolean }" });
    mixer.setRemoteMode(parsed.data.remote);
    res.json({ ok: true });
  });

  app.post("/api/sync", (_req, res) => {
    if (!mixer.isConnected()) {
      return res.status(400).json({ error: "Not connected to mixer" });
    }
    mixer.requestSync();
    res.json({ ok: true });
  });

  app.post("/api/fader", (req, res) => {
    const schema = z.object({
      attr: z.number().int().min(0).max(3),
      ch: z.number().int().min(0).max(7),
      position: z.number().int().min(0).max(63),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid fader params" });
    mixer.setFader(parsed.data.attr, parsed.data.ch, parsed.data.position);
    res.json({ ok: true });
  });

  app.post("/api/onoff", (req, res) => {
    const schema = z.object({
      attr: z.number().int().min(0).max(3),
      ch: z.number().int().min(0).max(7),
      on: z.boolean(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid on/off params" });
    mixer.setOnOff(parsed.data.attr, parsed.data.ch, parsed.data.on);
    res.json({ ok: true });
  });

  app.post("/api/matrix/input", (req, res) => {
    const schema = z.object({
      srcAttr: z.number().int().min(0).max(1),
      srcCh: z.number().int().min(0).max(7),
      bus: z.number().int().min(0).max(3),
      on: z.boolean(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid matrix input params" });
    mixer.setInputMatrix(parsed.data.srcAttr, parsed.data.srcCh, parsed.data.bus, parsed.data.on);
    res.json({ ok: true });
  });

  app.post("/api/matrix/input-gain", (req, res) => {
    const schema = z.object({
      srcAttr: z.number().int().min(0).max(1),
      srcCh: z.number().int().min(0).max(7),
      bus: z.number().int().min(0).max(3),
      value: z.number().int().min(0).max(70),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid crosspoint gain params" });
    mixer.setInputMatrixGain(parsed.data.srcAttr, parsed.data.srcCh, parsed.data.bus, parsed.data.value);
    res.json({ ok: true });
  });

  app.post("/api/matrix/output", (req, res) => {
    const schema = z.object({
      bus: z.number().int().min(0).max(3),
      dstCh: z.number().int().min(0).max(1),
      on: z.boolean(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid matrix output params" });
    mixer.setOutputMatrix(parsed.data.bus, parsed.data.dstCh, parsed.data.on);
    res.json({ ok: true });
  });

  app.post("/api/preset/load", (req, res) => {
    const schema = z.object({ preset: z.number().int().min(0).max(15) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid preset number" });
    mixer.loadPreset(parsed.data.preset);
    res.json({ ok: true });
  });

  app.post("/api/preset/store", (req, res) => {
    const schema = z.object({ preset: z.number().int().min(0).max(15) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid preset number" });
    mixer.storePreset(parsed.data.preset);
    res.json({ ok: true });
  });

  const cfg = readConfig();
  const autoIp   = cfg?.ip   || "192.168.14.1";
  const autoPort = cfg?.port ?? 3000;
  console.log(`[Mixer] Auto-connecting to ${autoIp}:${autoPort}`);
  mixer.connect(autoIp, autoPort);

  return httpServer;
}
