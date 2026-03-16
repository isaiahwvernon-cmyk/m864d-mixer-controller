import { useState, useCallback, useEffect } from "react";
import { useMixerWs } from "@/hooks/use-mixer";
import {
  defaultMixerState,
  type MixerState,
  faderPositionToDb,
  crosspointValueToDb,
  formatDb,
} from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { Settings, X, Radio, Eye, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";

// ── Types ─────────────────────────────────────────────────────────────────────
type Tab = "channels" | "matrix" | "presets";

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:       "#0b1120",
  panel:    "#111827",
  raised:   "#1a2540",
  border:   "#22344e",
  dim:      "#4a637d",
  text:     "#8bafc6",
  bright:   "#d0e6f4",
  accent:   "#00b4e0",
  monoIn:   "#2878ff",
  stereoIn: "#a040ff",
  monoOut:  "#18c068",
  recOut:   "#f83028",
  on:       "#22c55e",   // green = channel ON / active
  mute:     "#e04040",   // red  = muted / off
  store:    "#f59e0b",   // amber = preset store-mode warning
};

// Channel attr codes: 0=monoIn, 1=stereoIn, 2=monoOut, 3=recOut
const ATTR = { monoIn: 0, stereoIn: 1, monoOut: 2, recOut: 3 } as const;

const CH_DEFS = [
  ...Array.from({ length: 8 }, (_, i) => ({
    label: `IN ${i + 1}`, attr: ATTR.monoIn, ch: i, color: C.monoIn,
    getPos: (s: MixerState) => s.monoInFader[i] ?? 53,
    getOn:  (s: MixerState) => s.monoInOn[i]  ?? true,
    getLvl: (s: MixerState) => s.monoInLevel[i] ?? 0,
    matIdx: i,
  })),
  ...Array.from({ length: 2 }, (_, i) => ({
    label: `ST ${i + 1}`, attr: ATTR.stereoIn, ch: i, color: C.stereoIn,
    getPos: (s: MixerState) => s.stereoInFader[i] ?? 53,
    getOn:  (s: MixerState) => s.stereoInOn[i]  ?? true,
    getLvl: (s: MixerState) => s.stereoInLevel[i * 2] ?? 0,
    matIdx: 8 + i,
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    label: `OUT ${i + 1}`, attr: ATTR.monoOut, ch: i, color: C.monoOut,
    getPos: (s: MixerState) => s.monoOutFader[i] ?? 53,
    getOn:  (s: MixerState) => s.monoOutOn[i]  ?? true,
    getLvl: (s: MixerState) => s.monoOutLevel[i] ?? 0,
    matIdx: -1,
  })),
  ...Array.from({ length: 2 }, (_, i) => ({
    label: `REC ${i + 1}`, attr: ATTR.recOut, ch: i, color: C.recOut,
    getPos: (s: MixerState) => s.recOutFader[i] ?? 53,
    getOn:  (s: MixerState) => s.recOutOn[i]  ?? true,
    getLvl: (_: MixerState) => 0,
    matIdx: -1,
  })),
];

const MATRIX_INPUTS = [
  ...Array.from({ length: 8 }, (_, i) => ({
    label: `IN ${i + 1}`, color: C.monoIn, srcAttr: 0, srcCh: i, matIdx: i,
  })),
  ...Array.from({ length: 2 }, (_, i) => ({
    label: `ST ${i + 1}`, color: C.stereoIn, srcAttr: 1, srcCh: i, matIdx: 8 + i,
  })),
];


const SCALE_MARKS = [
  { pos: 63, label: "+10" },
  { pos: 58, label: "+6"  },
  { pos: 53, label: "0"   },
  { pos: 43, label: "-10" },
  { pos: 33, label: "-20" },
  { pos: 18, label: "-40" },
  { pos: 0,  label: "∞"   },
];

// ── ChannelStrip ──────────────────────────────────────────────────────────────
// Fixed heights inside each strip
const LABEL_H  = 22;
const DB_H     = 20;
const BTN_H    = 52;
// Padding at top/bottom of the track so the thumb is never clipped at either extreme
const FADER_PAD = 14;
// Chrome above the strip row: app header(46) + tab bar(38) + wrapper iframe overhead(60)
const OUTER_CHROME = 144;
// Fader travel: min 140px, max 300px — stays within the viewport and looks clean
const FADER_MIN = 140;
const FADER_MAX = 300;

function useFaderH(): number {
  const calc = () => Math.max(FADER_MIN, Math.min(FADER_MAX,
    window.innerHeight - OUTER_CHROME - LABEL_H - DB_H - BTN_H
  ));
  const [h, setH] = useState(calc);
  useEffect(() => {
    const onResize = () => setH(calc());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return h;
}

// Returns the server's LAN URL — always resolves (never stays empty indefinitely)
function useServerUrl(): string {
  const [url, setUrl] = useState("");
  useEffect(() => {
    fetch("/api/info")
      .then((r) => r.json())
      .then((d: { lanIP?: string; port?: number }) => {
        const port = d.port ?? 5000;
        const lan = d.lanIP ?? "";
        if (lan && lan !== "localhost" && lan !== "127.0.0.1") {
          setUrl(`http://${lan}:${port}`);
        } else {
          setUrl(`http://${window.location.hostname}:${port}`);
        }
      })
      .catch(() => setUrl(window.location.origin));
  }, []);
  return url;
}

// Reusable QR code card shown on connect screen and settings
function QRCard({ url }: { url: string }) {
  if (!url) return null;
  return (
    <div
      className="rounded-2xl p-4 flex flex-col items-center gap-3"
      style={{ background: C.panel, border: `1px solid ${C.border}` }}
    >
      <span className="font-mono uppercase self-start" style={{ fontSize: 8, color: C.dim, letterSpacing: "0.18em" }}>
        Open on tablet / phone
      </span>
      <div className="rounded-xl p-2" style={{ background: "#ffffff" }}>
        <QRCodeSVG value={url} size={160} bgColor="#ffffff" fgColor="#0b1120" level="M" />
      </div>
      <span
        className="font-mono text-center select-all"
        style={{ fontSize: 11, color: C.accent, letterSpacing: "0.04em" }}
        data-testid="text-server-url"
      >
        {url}
      </span>
      <span className="font-mono text-center" style={{ fontSize: 8, color: C.dim, letterSpacing: "0.08em" }}>
        Scan or type this address on any device on the same Wi-Fi network.
      </span>
    </div>
  );
}

interface StripProps {
  label: string;
  color: string;
  position: number;
  on: boolean;
  level: number;
  faderH: number;
  onFader: (v: number) => void;
  onToggle: () => void;
}

function ChannelStrip({ label, color, position, on, level, faderH, onFader, onToggle }: StripProps) {
  const db = faderPositionToDb(position);
  const dbStr = formatDb(db);
  const pct0db = (1 - 53 / 63) * 100;
  const stripH = LABEL_H + faderH + DB_H + BTN_H;

  return (
    <div
      className="flex flex-col items-center shrink-0 select-none"
      style={{
        width: 76, height: stripH,
        background: C.panel,
        borderRight: `1px solid ${C.border}`,
        borderRadius: 8,
        overflow: "hidden",
        transition: "background 0.2s",
      }}
    >
      {/* Label band */}
      <div
        className="w-full flex items-center justify-center font-mono uppercase"
        style={{
          height: LABEL_H,
          flexShrink: 0,
          background: color + "22",
          borderBottom: `1px solid ${color}44`,
          fontSize: 8,
          color,
          letterSpacing: "0.2em",
        }}
      >
        {label}
      </div>

      {/* Fader + scale + meter — explicit pixel height = faderH */}
      <div className="relative w-full" style={{ height: faderH, flexShrink: 0, overflow: "hidden" }}>
        {/* Scale marks — positioned in px to match the padded track range */}
        {SCALE_MARKS.map(({ pos, label: ml }) => {
          // The thumb center only travels within [thumbHalf .. trackRange-thumbHalf]
          // because the browser insets the thumb at both ends.
          // THUMB_CSS (46px) = CSS width of thumb = visual height after -90° rotation.
          const THUMB_CSS   = 46;
          const thumbHalf   = THUMB_CSS / 2;
          const trackRange  = faderH - 2 * FADER_PAD;
          const effectiveRange = trackRange - THUMB_CSS;
          const topPx = FADER_PAD + thumbHalf + (1 - pos / 63) * effectiveRange;
          return (
            <div
              key={pos}
              className="absolute flex items-center"
              style={{
                left: 0, width: 20,
                top: topPx,
                transform: "translateY(-50%)",
                justifyContent: "flex-end",
                gap: 2,
              }}
            >
              <span style={{ fontSize: 7, fontFamily: "monospace", lineHeight: 1, color: pos === 53 ? color + "cc" : C.dim }}>
                {ml}
              </span>
              <div style={{ width: pos === 53 ? 5 : 3, height: 1, background: pos === 53 ? color : C.border, opacity: pos === 53 ? 0.7 : 0.4 }} />
            </div>
          );
        })}

        {/* 0 dB reference line — same inset calculation */}
        {(() => {
          const THUMB_CSS = 46;
          const trackRange = faderH - 2 * FADER_PAD;
          const top0db = FADER_PAD + THUMB_CSS / 2 + (1 - 53 / 63) * (trackRange - THUMB_CSS);
          return (
            <div className="absolute pointer-events-none"
              style={{ left: 20, right: 8, top: top0db, height: 1, background: color, opacity: 0.25 }}
            />
          );
        })()}

        {/* Rotated slider — width = track range (faderH minus padding at each end) */}
        <div className="absolute" style={{ left: 20, right: 8, top: FADER_PAD, bottom: FADER_PAD }}>
          <input
            type="range" min={0} max={63} value={position}
            onChange={(e) => onFader(Number(e.target.value))}
            className="mixer-fader"
            style={{ width: faderH - 2 * FADER_PAD, height: 44 }}
            data-testid={`fader-${label}`}
          />
        </div>

      </div>

      {/* dB readout */}
      <div
        className="font-mono text-center w-full"
        style={{ height: DB_H, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, color: on ? C.bright : C.dim, letterSpacing: "0.04em" }}
      >
        {dbStr}
      </div>

      {/* ON / MUTE button */}
      <button
        onClick={onToggle}
        className="w-full flex flex-col items-center justify-center gap-1.5"
        style={{
          height: BTN_H, flexShrink: 0,
          background: on ? `${C.on}22` : `${C.mute}0e`,
          borderTop: `1px solid ${on ? C.on + "55" : C.mute + "33"}`,
          transition: "background 0.2s, border-color 0.2s",
        }}
        data-testid={`btn-on-${label}`}
      >
        <div
          style={{
            width: 8, height: 8, borderRadius: "50%",
            background: on ? C.on : C.mute + "88",
            boxShadow: on
              ? `0 0 6px 2px ${C.on}bb, 0 0 12px ${C.on}55`
              : `0 0 4px 1px ${C.mute}55`,
            transition: "background 0.2s, box-shadow 0.2s",
          }}
        />
        <span
          className="font-mono uppercase"
          style={{
            fontSize: 8, letterSpacing: "0.14em",
            color: on ? C.on : C.mute + "99",
            transition: "color 0.2s",
          }}
        >
          {on ? "ON" : "MUTE"}
        </span>
      </button>
    </div>
  );
}

// ── MatrixGrid ────────────────────────────────────────────────────────────────
interface MatrixGridProps {
  mixState: MixerState;
  onToggleInput: (srcAttr: number, srcCh: number, bus: number, cur: boolean) => void;
  onToggleOutput: (bus: number, dstCh: number, cur: boolean) => void;
  onSetGain: (srcAttr: number, srcCh: number, bus: number, value: number) => void;
}

const GAIN_OPTS = [
  { value: 70, label: "+10" },
  { value: 60, label: "+4"  },
  { value: 46, label: "0"   },
  { value: 36, label: "-6"  },
  { value: 26, label: "-16" },
  { value: 6,  label: "-36" },
  { value: 0,  label: "–∞"  },
];

function MatrixGrid({ mixState, onToggleInput, onToggleOutput, onSetGain }: MatrixGridProps) {
  const [gainEdit, setGainEdit] = useState<{ srcAttr: number; srcCh: number; matIdx: number; bus: number } | null>(null);

  const BUS_LABELS = ["OUT 1", "OUT 2", "OUT 3", "OUT 4"];
  const OUT_LABELS  = ["OUT 1", "OUT 2", "OUT 3", "OUT 4"];
  const REC_LABELS  = ["REC L", "REC R"];

  return (
    <div className="flex flex-col h-full overflow-auto p-4 gap-5">
      {/* Gain editor sheet */}
      {gainEdit !== null && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ background: "rgba(0,0,0,0.75)" }}
          onClick={() => setGainEdit(null)}
        >
          <div
            className="w-full max-w-sm rounded-t-2xl p-5"
            style={{ background: C.raised, border: `1px solid ${C.border}` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <span className="font-mono text-xs uppercase tracking-widest" style={{ color: C.accent }}>
                {MATRIX_INPUTS[gainEdit.matIdx]?.label} → {BUS_LABELS[gainEdit.bus]} Gain
              </span>
              <button onClick={() => setGainEdit(null)}><X size={16} color={C.dim} /></button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {GAIN_OPTS.map(({ value, label }) => {
                const cur = mixState.inputMatrixGain[gainEdit.matIdx]?.[gainEdit.bus] ?? 46;
                const active = cur === value;
                return (
                  <button
                    key={value}
                    onClick={() => {
                      onSetGain(gainEdit.srcAttr, gainEdit.srcCh, gainEdit.bus, value);
                      setGainEdit(null);
                    }}
                    className="rounded-xl py-3 font-mono text-sm transition-all"
                    style={{
                      background: active ? `${C.accent}28` : C.panel,
                      border: `1px solid ${active ? C.accent : C.border}`,
                      color: active ? C.accent : C.text,
                      boxShadow: active ? `0 0 10px ${C.accent}44` : "none",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Input → Bus section */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div style={{ width: 2, height: 14, background: C.accent, borderRadius: 1 }} />
          <span className="font-mono text-xs uppercase tracking-widest" style={{ color: C.accent }}>
            Input → Mix Bus
          </span>
        </div>

        <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${C.border}`, background: C.panel }}>
          {/* Bus header row */}
          <div className="flex" style={{ borderBottom: `1px solid ${C.border}` }}>
            <div style={{ width: 76, minWidth: 76 }} />
            {BUS_LABELS.map((b, bi) => (
              <div
                key={bi}
                className="flex-1 text-center font-mono py-2 uppercase"
                style={{ fontSize: 9, color: C.accent, letterSpacing: "0.15em", borderLeft: `1px solid ${C.border}` }}
              >
                {b}
              </div>
            ))}
          </div>

          {MATRIX_INPUTS.map(({ label, color, srcAttr, srcCh, matIdx }) => (
            <div
              key={matIdx}
              className="flex"
              style={{ borderBottom: `1px solid ${C.border}` }}
            >
              {/* Source label */}
              <div
                className="flex items-center gap-1.5 px-2 font-mono"
                style={{ width: 76, minWidth: 76, fontSize: 9, color, borderRight: `1px solid ${C.border}` }}
              >
                <div style={{ width: 3, height: 14, background: color, borderRadius: 2, opacity: 0.7 }} />
                {label}
              </div>

              {/* Bus toggle cells */}
              {[0, 1, 2, 3].map((bus) => {
                const on = mixState.inputMatrix[matIdx]?.[bus] === true;
                const gainVal = mixState.inputMatrixGain[matIdx]?.[bus] ?? 46;
                const gainDb = crosspointValueToDb(gainVal);
                const gainStr = gainDb === 0 ? "" : formatDb(gainDb);
                return (
                  <div
                    key={bus}
                    className="flex-1 flex flex-col items-center justify-center py-2 gap-1"
                    style={{ borderLeft: `1px solid ${C.border}`, minHeight: 56 }}
                  >
                    <button
                      onClick={() => onToggleInput(srcAttr, srcCh, bus, on)}
                      className="rounded-lg transition-all flex items-center justify-center"
                      style={{
                        width: 42,
                        height: 32,
                        background: on ? `${color}22` : C.raised,
                        border: `1px solid ${on ? color + "88" : C.border}`,
                        boxShadow: on ? `0 0 10px ${color}44` : "none",
                      }}
                      data-testid={`matrix-in-${matIdx}-${bus}`}
                    >
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: on ? color : C.border,
                          boxShadow: on ? `0 0 5px 2px ${color}` : "none",
                          transition: "background 0.2s, box-shadow 0.2s",
                        }}
                      />
                    </button>
                    {on && gainStr && (
                      <button
                        onClick={() => setGainEdit({ srcAttr, srcCh, matIdx, bus })}
                        className="font-mono"
                        style={{ fontSize: 8, color: `${color}bb`, lineHeight: 1 }}
                      >
                        {gainStr}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Output → Rec section */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div style={{ width: 2, height: 14, background: C.monoOut, borderRadius: 1 }} />
          <span className="font-mono text-xs uppercase tracking-widest" style={{ color: C.monoOut }}>
            Output → Rec Bus
          </span>
        </div>

        <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${C.border}`, background: C.panel }}>
          {/* Output header row */}
          <div className="flex" style={{ borderBottom: `1px solid ${C.border}` }}>
            <div style={{ width: 76, minWidth: 76 }} />
            {OUT_LABELS.map((b, bi) => (
              <div
                key={bi}
                className="flex-1 text-center font-mono py-2 uppercase"
                style={{ fontSize: 9, color: C.monoOut, letterSpacing: "0.15em", borderLeft: `1px solid ${C.border}` }}
              >
                {b}
              </div>
            ))}
          </div>

          {REC_LABELS.map((rowLabel, dstCh) => (
            <div
              key={dstCh}
              className="flex"
              style={{ borderBottom: dstCh < 1 ? `1px solid ${C.border}` : "none" }}
            >
              <div
                className="flex items-center gap-1.5 px-2 font-mono"
                style={{ width: 76, minWidth: 76, fontSize: 9, color: C.recOut, borderRight: `1px solid ${C.border}` }}
              >
                <div style={{ width: 3, height: 14, background: C.recOut, borderRadius: 2, opacity: 0.7 }} />
                {rowLabel}
              </div>
              {[0, 1, 2, 3].map((bus) => {
                const on = mixState.outputMatrix[bus]?.[dstCh] === true;
                return (
                  <div
                    key={bus}
                    className="flex-1 flex items-center justify-center py-3"
                    style={{ borderLeft: `1px solid ${C.border}` }}
                  >
                    <button
                      onClick={() => onToggleOutput(bus, dstCh, on)}
                      className="rounded-lg transition-all flex items-center justify-center"
                      style={{
                        width: 42,
                        height: 32,
                        background: on ? `${C.recOut}22` : C.raised,
                        border: `1px solid ${on ? C.recOut + "88" : C.border}`,
                        boxShadow: on ? `0 0 10px ${C.recOut}44` : "none",
                      }}
                      data-testid={`matrix-out-${dstCh}-${bus}`}
                    >
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: on ? C.recOut : C.border,
                          boxShadow: on ? `0 0 5px 2px ${C.recOut}` : "none",
                          transition: "background 0.2s, box-shadow 0.2s",
                        }}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── PresetsPanel ──────────────────────────────────────────────────────────────
interface PresetsPanelProps {
  currentPreset: number;
  onLoad: (preset: number) => void;
  onStore: (preset: number) => void;
}

function PresetsPanel({ currentPreset, onLoad, onStore }: PresetsPanelProps) {
  const [mode, setMode] = useState<"load" | "store">("load");
  const [confirm, setConfirm] = useState<number | null>(null);

  function handleTap(preset: number) {
    if (mode === "load") {
      onLoad(preset);
    } else {
      if (confirm === preset) {
        onStore(preset);
        setConfirm(null);
      } else {
        setConfirm(preset);
        setTimeout(() => setConfirm(null), 2000);
      }
    }
  }

  const activeColor = mode === "store" ? C.store : C.accent;

  return (
    <div className="flex flex-col h-full overflow-auto p-4 gap-4">
      {/* Mode toggle */}
      <div
        className="flex rounded-2xl p-1 gap-1 self-start"
        style={{ background: C.panel, border: `1px solid ${C.border}` }}
      >
        {(["load", "store"] as const).map((m) => {
          const mc = m === "store" ? C.store : C.accent;
          return (
            <button
              key={m}
              onClick={() => { setMode(m); setConfirm(null); }}
              className="rounded-xl px-6 py-2 font-mono uppercase tracking-widest transition-all"
              style={{
                fontSize: 10,
                letterSpacing: "0.2em",
                background: mode === m ? `${mc}1e` : "transparent",
                color: mode === m ? mc : C.dim,
                border: `1px solid ${mode === m ? mc + "55" : "transparent"}`,
                boxShadow: mode === m ? `0 0 12px ${mc}22` : "none",
              }}
              data-testid={`btn-mode-${m}`}
            >
              {m === "load" ? "▶ Load" : "● Store"}
            </button>
          );
        })}
      </div>

      {mode === "store" && (
        <div
          className="rounded-xl px-4 py-2.5 text-xs font-mono"
          style={{ background: `${C.store}0e`, border: `1px solid ${C.store}33`, color: C.store }}
        >
          Tap a slot once to select it, tap again to confirm store.
        </div>
      )}

      {/* 4 × 4 grid */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        {Array.from({ length: 16 }, (_, i) => {
          const preset = i;          // 0-indexed sent to API
          const slotNum = i + 1;     // 1-indexed shown to user
          const isActive  = currentPreset === preset;
          const isConfirm = confirm === preset;

          return (
            <button
              key={preset}
              onClick={() => handleTap(preset)}
              className="rounded-2xl flex flex-col items-center justify-center gap-2 transition-all active:scale-95"
              style={{
                height: 84,
                background: isActive
                  ? `${activeColor}1e`
                  : isConfirm
                  ? `${C.store}14`
                  : C.panel,
                border: `1px solid ${
                  isActive  ? activeColor + "77" :
                  isConfirm ? C.store + "55" :
                  C.border
                }`,
                boxShadow: isActive
                  ? `0 0 20px ${activeColor}33, inset 0 0 24px ${activeColor}08`
                  : isConfirm
                  ? `0 0 14px ${C.store}22`
                  : "none",
              }}
              data-testid={`btn-preset-${slotNum}`}
            >
              <span
                className="font-mono font-bold tabular-nums"
                style={{
                  fontSize: 24,
                  lineHeight: 1,
                  color: isActive ? activeColor : isConfirm ? C.store : C.dim,
                }}
              >
                {slotNum.toString().padStart(2, "0")}
              </span>
              <div className="flex items-center gap-1.5">
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: isActive ? activeColor : C.raised,
                    boxShadow: isActive ? `0 0 4px 2px ${activeColor}` : "none",
                  }}
                />
                <span
                  className="font-mono uppercase"
                  style={{
                    fontSize: 7,
                    letterSpacing: "0.2em",
                    color: isActive ? activeColor : isConfirm ? C.store : C.dim,
                  }}
                >
                  {isActive ? "ACTIVE" : isConfirm ? "CONFIRM?" : "PRESET"}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── ConnectForm ───────────────────────────────────────────────────────────────
function ConnectForm({ onDemo }: { onDemo: () => void }) {
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("3000");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  async function connect() {
    if (!ip.trim()) return;
    setLoading(true);
    try {
      await apiRequest("POST", "/api/connect", { ip: ip.trim(), port: parseInt(port) });
    } catch {
      toast({ title: "Connection failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  const inputBase: React.CSSProperties = {
    background: C.panel,
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    color: C.bright,
    fontSize: 15,
    padding: "13px 15px",
    fontFamily: "monospace",
    outline: "none",
    width: "100%",
    WebkitAppearance: "none",
    transition: "border-color 0.2s",
  };

  return (
    <div
      className="flex flex-col h-full items-center justify-center p-6"
      style={{ background: C.bg }}
    >
      <div
        className="w-full max-w-sm rounded-3xl p-8"
        style={{ background: C.panel, border: `1px solid ${C.border}` }}
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <div
            className="mx-auto flex items-center justify-center font-black rounded-2xl mb-4"
            style={{
              width: 60,
              height: 60,
              fontSize: 26,
              background: `linear-gradient(135deg, ${C.accent}30, ${C.accent}10)`,
              border: `1px solid ${C.accent}44`,
              color: C.accent,
              boxShadow: `0 0 30px ${C.accent}22`,
            }}
          >
            M
          </div>
          <div
            className="font-mono font-bold uppercase"
            style={{ fontSize: 13, color: C.bright, letterSpacing: "0.35em" }}
          >
            M-864D
          </div>
          <div
            className="font-mono mt-1"
            style={{ fontSize: 10, color: C.dim, letterSpacing: "0.18em" }}
          >
            Digital Stereo Mixer
          </div>
        </div>

        <label className="font-mono uppercase" style={{ fontSize: 8, color: C.dim, letterSpacing: "0.2em" }}>
          Mixer IP
        </label>
        <input
          style={{ ...inputBase, marginTop: 6, marginBottom: 12 }}
          type="text"
          placeholder="192.168.1.100"
          value={ip}
          onChange={(e) => setIp(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && connect()}
          data-testid="input-ip"
        />

        <label className="font-mono uppercase" style={{ fontSize: 8, color: C.dim, letterSpacing: "0.2em" }}>
          Port
        </label>
        <input
          style={{ ...inputBase, marginTop: 6, marginBottom: 20 }}
          type="number"
          value={port}
          onChange={(e) => setPort(e.target.value)}
          data-testid="input-port"
        />

        <button
          onClick={connect}
          disabled={loading || !ip.trim()}
          className="w-full rounded-2xl py-3.5 font-mono uppercase tracking-widest transition-all"
          style={{
            fontSize: 11,
            letterSpacing: "0.22em",
            background: `linear-gradient(135deg, ${C.accent}20, ${C.accent}0c)`,
            border: `1px solid ${C.accent}55`,
            color: C.accent,
            boxShadow: `0 0 18px ${C.accent}1a`,
            opacity: loading || !ip.trim() ? 0.5 : 1,
          }}
          data-testid="btn-connect"
        >
          {loading ? "Connecting…" : "Connect"}
        </button>

        <div className="flex items-center gap-3 my-5">
          <div style={{ flex: 1, height: 1, background: C.border }} />
          <span className="font-mono uppercase" style={{ fontSize: 8, color: C.dim }}>or</span>
          <div style={{ flex: 1, height: 1, background: C.border }} />
        </div>

        <button
          onClick={onDemo}
          className="w-full rounded-2xl py-3.5 font-mono uppercase tracking-widest transition-all"
          style={{
            fontSize: 10,
            letterSpacing: "0.18em",
            background: C.raised,
            border: `1px solid ${C.border}`,
            color: C.dim,
          }}
          data-testid="btn-demo-mode"
        >
          Preview Interface
        </button>
      </div>
    </div>
  );
}

// ── SettingsPanel ─────────────────────────────────────────────────────────────
function SettingsPanel({ onClose, wsState }: { onClose: () => void; wsState: MixerState }) {
  const [ip, setIp] = useState(wsState.ip || "");
  const [port, setPort] = useState(String(wsState.port || 3000));
  const serverUrl = useServerUrl();
  const { toast } = useToast();

  async function handleConnect() {
    try {
      await apiRequest("POST", "/api/connect", { ip: ip.trim(), port: parseInt(port) });
      onClose();
    } catch {
      toast({ title: "Connection failed", variant: "destructive" });
    }
  }

  async function handleDisconnect() {
    try {
      await apiRequest("POST", "/api/disconnect", {});
      onClose();
    } catch {
      toast({ title: "Disconnect failed", variant: "destructive" });
    }
  }

  const inputBase: React.CSSProperties = {
    background: C.panel,
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    color: C.bright,
    fontSize: 14,
    padding: "11px 13px",
    fontFamily: "monospace",
    outline: "none",
    width: "100%",
    transition: "border-color 0.2s",
  };

  return (
    <div
      className="flex flex-col h-full overflow-auto p-5 gap-4"
      style={{ background: C.bg }}
    >
      <div className="flex items-center justify-between">
        <span
          className="font-mono uppercase tracking-widest"
          style={{ fontSize: 10, color: C.accent, letterSpacing: "0.28em" }}
        >
          Settings
        </span>
        <button onClick={onClose}><X size={17} color={C.dim} /></button>
      </div>

      {/* QR code for opening on tablets / phones */}
      <QRCard url={serverUrl} />

      {/* Status indicator */}
      <div
        className="flex items-center gap-3 rounded-2xl p-4"
        style={{ background: C.panel, border: `1px solid ${C.border}` }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: wsState.connected ? C.monoOut : C.dim,
            boxShadow: wsState.connected ? `0 0 6px 2px ${C.monoOut}` : "none",
          }}
        />
        <div>
          <div
            className="font-mono"
            style={{ fontSize: 12, color: wsState.connected ? C.monoOut : C.dim }}
          >
            {wsState.connected ? "Connected" : "Disconnected"}
          </div>
          {wsState.connected && wsState.ip && (
            <div className="font-mono" style={{ fontSize: 10, color: C.dim }}>
              {wsState.ip}:{wsState.port}
            </div>
          )}
        </div>
      </div>

      {/* Connection form */}
      <div
        className="rounded-2xl p-4 flex flex-col gap-3"
        style={{ background: C.panel, border: `1px solid ${C.border}` }}
      >
        <label className="font-mono uppercase" style={{ fontSize: 8, color: C.dim, letterSpacing: "0.18em" }}>
          IP Address
        </label>
        <input
          style={inputBase}
          type="text"
          placeholder="192.168.1.100"
          value={ip}
          onChange={(e) => setIp(e.target.value)}
          data-testid="settings-input-ip"
        />
        <label className="font-mono uppercase" style={{ fontSize: 8, color: C.dim, letterSpacing: "0.18em" }}>
          Port
        </label>
        <input
          style={inputBase}
          type="number"
          value={port}
          onChange={(e) => setPort(e.target.value)}
          data-testid="settings-input-port"
        />
        <button
          onClick={handleConnect}
          className="rounded-xl py-3 font-mono uppercase tracking-widest"
          style={{
            fontSize: 10,
            letterSpacing: "0.2em",
            background: `${C.accent}1e`,
            border: `1px solid ${C.accent}44`,
            color: C.accent,
          }}
          data-testid="settings-btn-connect"
        >
          Connect
        </button>
        {wsState.connected && (
          <button
            onClick={handleDisconnect}
            className="rounded-xl py-3 font-mono uppercase tracking-widest"
            style={{
              fontSize: 10,
              letterSpacing: "0.2em",
              background: `${C.recOut}14`,
              border: `1px solid ${C.recOut}33`,
              color: C.recOut,
            }}
            data-testid="settings-btn-disconnect"
          >
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
}

// ── Home ──────────────────────────────────────────────────────────────────────
export default function Home() {
  const wsState = useMixerWs();
  const [tab, setTab] = useState<Tab>("channels");
  const [showSettings, setShowSettings] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  // Local state for demo mode (so controls feel responsive)
  const [demoState, setDemoState] = useState<MixerState>(defaultMixerState);
  const { toast } = useToast();

  const faderH = useFaderH();
  // "soft-disconnected" = user toggled View-Only; mixer UI stays visible
  const softDisconnected = !wsState.connected && wsState.remoteMode === false && !!wsState.ip;
  const isActive = wsState.connected || demoMode || softDisconnected;
  // Use real ws state when connected or soft-disconnected (shows last known state)
  const mixState: MixerState = (wsState.connected || softDisconnected) ? wsState : demoState;

  // viewOnly = either connected in locked mode, OR soft-disconnected
  const viewOnly = wsState.remoteMode === false;

  async function toggleRemote() {
    try {
      await apiRequest("POST", "/api/remote", { remote: wsState.remoteMode !== true });
    } catch {
      toast({ title: "Failed to toggle control lock", variant: "destructive" });
    }
  }

  // ── Sync ───────────────────────────────────────────────────────────────────
  const syncMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/sync"),
    onSuccess: () => toast({ title: "Synced", description: "Fader levels read from mixer" }),
    onError: () => toast({ title: "Sync failed", description: "Not connected to mixer", variant: "destructive" }),
  });

  // ── Fader ──────────────────────────────────────────────────────────────────
  const setFader = useCallback(
    async (attr: number, ch: number, position: number) => {
      if (viewOnly) return;
      if (demoMode && !wsState.connected) {
        setDemoState((prev) => {
          const next = { ...prev };
          if (attr === 0) { next.monoInFader = [...prev.monoInFader]; next.monoInFader[ch] = position; }
          if (attr === 1) { next.stereoInFader = [...prev.stereoInFader]; next.stereoInFader[ch] = position; }
          if (attr === 2) { next.monoOutFader = [...prev.monoOutFader]; next.monoOutFader[ch] = position; }
          if (attr === 3) { next.recOutFader = [...prev.recOutFader]; next.recOutFader[ch] = position; }
          return next;
        });
        return;
      }
      try {
        await apiRequest("POST", "/api/fader", { attr, ch, position });
      } catch {
        toast({ title: "Fader command failed", variant: "destructive" });
      }
    },
    [viewOnly, demoMode, wsState.connected, toast],
  );

  // ── On/Off ─────────────────────────────────────────────────────────────────
  const toggleOn = useCallback(
    async (attr: number, ch: number, curOn: boolean) => {
      if (viewOnly) return;
      if (demoMode && !wsState.connected) {
        setDemoState((prev) => {
          const next = { ...prev };
          if (attr === 0) { next.monoInOn = [...prev.monoInOn]; next.monoInOn[ch] = !curOn; }
          if (attr === 1) { next.stereoInOn = [...prev.stereoInOn]; next.stereoInOn[ch] = !curOn; }
          if (attr === 2) { next.monoOutOn = [...prev.monoOutOn]; next.monoOutOn[ch] = !curOn; }
          if (attr === 3) { next.recOutOn = [...prev.recOutOn]; next.recOutOn[ch] = !curOn; }
          return next;
        });
        return;
      }
      try {
        await apiRequest("POST", "/api/onoff", { attr, ch, on: !curOn });
      } catch {
        toast({ title: "On/off command failed", variant: "destructive" });
      }
    },
    [viewOnly, demoMode, wsState.connected, toast],
  );

  // ── Matrix input toggle ────────────────────────────────────────────────────
  const toggleInputMatrix = useCallback(
    async (srcAttr: number, srcCh: number, bus: number, cur: boolean) => {
      if (viewOnly) return;
      const matIdx = srcAttr === 0 ? srcCh : 8 + srcCh;
      if (demoMode && !wsState.connected) {
        setDemoState((prev) => {
          const next = { ...prev };
          next.inputMatrix = prev.inputMatrix.map((row, ri) =>
            ri === matIdx ? row.map((v, bi) => (bi === bus ? !cur : v)) : row,
          );
          return next;
        });
        return;
      }
      try {
        await apiRequest("POST", "/api/matrix/input", { srcAttr, srcCh, bus, on: !cur });
      } catch {
        toast({ title: "Matrix command failed", variant: "destructive" });
      }
    },
    [viewOnly, demoMode, wsState.connected, toast],
  );

  // ── Matrix output toggle ───────────────────────────────────────────────────
  const toggleOutputMatrix = useCallback(
    async (bus: number, dstCh: number, cur: boolean) => {
      if (viewOnly) return;
      if (demoMode && !wsState.connected) {
        setDemoState((prev) => {
          const next = { ...prev };
          next.outputMatrix = prev.outputMatrix.map((row, bi) =>
            bi === bus ? row.map((v, di) => (di === dstCh ? !cur : v)) : row,
          );
          return next;
        });
        return;
      }
      try {
        await apiRequest("POST", "/api/matrix/output", { bus, dstCh, on: !cur });
      } catch {
        toast({ title: "Matrix command failed", variant: "destructive" });
      }
    },
    [viewOnly, demoMode, wsState.connected, toast],
  );

  // ── Crosspoint gain ────────────────────────────────────────────────────────
  const setInputGain = useCallback(
    async (srcAttr: number, srcCh: number, bus: number, value: number) => {
      if (viewOnly) return;
      const matIdx = srcAttr === 0 ? srcCh : 8 + srcCh;
      if (demoMode && !wsState.connected) {
        setDemoState((prev) => {
          const next = { ...prev };
          next.inputMatrixGain = prev.inputMatrixGain.map((row, ri) =>
            ri === matIdx ? row.map((v, bi) => (bi === bus ? value : v)) : row,
          );
          return next;
        });
        return;
      }
      try {
        await apiRequest("POST", "/api/matrix/input-gain", { srcAttr, srcCh, bus, value });
      } catch {
        toast({ title: "Gain command failed", variant: "destructive" });
      }
    },
    [viewOnly, demoMode, wsState.connected, toast],
  );

  // ── Presets ────────────────────────────────────────────────────────────────
  const loadPreset = useCallback(
    async (preset: number) => {
      if (viewOnly) return;
      if (demoMode && !wsState.connected) {
        setDemoState((prev) => ({ ...prev, currentPreset: preset }));
        toast({ title: `Preset ${preset + 1} loaded` });
        return;
      }
      try {
        await apiRequest("POST", "/api/preset/load", { preset });
        toast({ title: `Preset ${preset + 1} loaded` });
      } catch {
        toast({ title: "Failed to load preset", variant: "destructive" });
      }
    },
    [viewOnly, demoMode, wsState.connected, toast],
  );

  const storePreset = useCallback(
    async (preset: number) => {
      if (viewOnly) return;
      if (demoMode && !wsState.connected) {
        toast({ title: `Preset ${preset + 1} stored (preview)` });
        return;
      }
      try {
        await apiRequest("POST", "/api/preset/store", { preset });
        toast({ title: `Preset ${preset + 1} stored` });
      } catch {
        toast({ title: "Failed to store preset", variant: "destructive" });
      }
    },
    [viewOnly, demoMode, wsState.connected, toast],
  );

  const TABS: { id: Tab; label: string }[] = [
    { id: "channels", label: "Channels" },
    { id: "matrix",   label: "Matrix"   },
    { id: "presets",  label: "Presets"  },
  ];

  return (
    <div
      className="flex flex-col dsp-screen"
      style={{ height: "100dvh", overflow: "hidden", color: C.bright }}
    >
      {/* ── Header bar ── */}
      <div
        className="flex items-center justify-between px-4 shrink-0"
        style={{ height: 46, background: C.panel, borderBottom: `1px solid ${C.border}` }}
      >
        <div className="flex items-center gap-3">
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: wsState.connected ? C.monoOut : demoMode ? "#996600" : C.dim,
              boxShadow: wsState.connected
                ? `0 0 6px 2px ${C.monoOut}`
                : demoMode
                ? "0 0 6px 2px #996600"
                : "none",
            }}
          />
          <span
            className="font-mono font-bold uppercase"
            style={{ fontSize: 11, color: C.bright, letterSpacing: "0.28em" }}
          >
            M-864D
          </span>
          {demoMode && !wsState.connected && (
            <span
              className="font-mono uppercase rounded px-2 py-0.5"
              style={{
                fontSize: 8,
                letterSpacing: "0.14em",
                background: "#1c1000",
                color: "#996600",
                border: "1px solid #553300",
              }}
            >
              PREVIEW
            </span>
          )}
          {wsState.connected && (
            <span
              className="font-mono uppercase rounded px-2 py-0.5"
              style={{
                fontSize: 8,
                letterSpacing: "0.14em",
                background: wsState.remoteMode === false ? "rgba(229,160,0,0.12)" : "rgba(0,180,224,0.12)",
                color: wsState.remoteMode === false ? C.store : C.accent,
                border: `1px solid ${wsState.remoteMode === false ? C.store + "44" : C.accent + "44"}`,
              }}
              data-testid="status-remote-mode"
            >
              {wsState.remoteMode === false ? "VIEW ONLY" : "CONTROL"}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Sync button — reads all fader positions from mixer */}
          {wsState.connected && !viewOnly && (
            <button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className="flex items-center gap-1.5 font-mono uppercase rounded-xl px-3 py-1.5"
              style={{
                fontSize: 8,
                letterSpacing: "0.1em",
                background: `${C.monoOut}12`,
                border: `1px solid ${C.monoOut}33`,
                color: C.monoOut,
                opacity: syncMutation.isPending ? 0.5 : 1,
                transition: "opacity 0.15s",
              }}
              title="Read all fader levels from mixer"
              data-testid="btn-sync"
            >
              <RefreshCw size={9} style={{ animation: syncMutation.isPending ? "spin 0.8s linear infinite" : "none" }} />
              Sync
            </button>
          )}
          {wsState.connected && (
            <button
              onClick={toggleRemote}
              className="flex items-center gap-1.5 font-mono uppercase rounded-xl px-3 py-1.5"
              style={{
                fontSize: 8,
                letterSpacing: "0.1em",
                background: wsState.remoteMode === false ? `${C.store}14` : `${C.accent}14`,
                border: `1px solid ${wsState.remoteMode === false ? C.store + "33" : C.accent + "33"}`,
                color: wsState.remoteMode === false ? C.store : C.accent,
              }}
              title={wsState.remoteMode === false
                ? "Click to enable control — currently view only"
                : "Click to lock controls — currently sending commands"}
              data-testid="btn-toggle-remote"
            >
              {wsState.remoteMode === false
                ? <><Eye size={9} /> View Only</>
                : <><Radio size={9} /> Control</>}
            </button>
          )}
          {demoMode && !wsState.connected && (
            <button
              onClick={() => setDemoMode(false)}
              className="flex items-center gap-1 font-mono uppercase rounded-xl px-3 py-1.5"
              style={{
                fontSize: 8,
                letterSpacing: "0.1em",
                background: C.raised,
                border: `1px solid ${C.border}`,
                color: C.dim,
              }}
            >
              <X size={9} /> Exit
            </button>
          )}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="flex items-center justify-center rounded-xl transition-all"
            style={{
              width: 34,
              height: 34,
              background: showSettings ? `${C.accent}1e` : C.raised,
              border: `1px solid ${showSettings ? C.accent + "55" : C.border}`,
            }}
            data-testid="btn-settings"
          >
            <Settings size={14} color={showSettings ? C.accent : C.dim} />
          </button>
        </div>
      </div>

      {/* ── Settings ── */}
      {showSettings && (
        <div className="flex-1 overflow-hidden">
          <SettingsPanel wsState={wsState} onClose={() => setShowSettings(false)} />
        </div>
      )}

      {/* ── Connect screen ── */}
      {!isActive && !showSettings && (
        <div className="flex-1 overflow-hidden">
          <ConnectForm onDemo={() => setDemoMode(true)} />
        </div>
      )}

      {/* ── Main mixer UI ── */}
      {isActive && !showSettings && (
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* View-only banner */}
          {viewOnly && (
            <div
              className="flex items-center justify-center gap-2 shrink-0 font-mono uppercase"
              style={{
                height: 28,
                fontSize: 9,
                letterSpacing: "0.22em",
                background: `${C.store}1a`,
                borderBottom: `1px solid ${C.store}44`,
                color: C.store,
              }}
              data-testid="banner-view-only"
            >
              <Eye size={10} />
              {softDisconnected ? "Disconnected from mixer — tap Control to reconnect" : "Controls locked — tap Control to re-enable"}
            </div>
          )}
          {/* Tab bar */}
          <div
            className="flex shrink-0 px-3 gap-1 pt-1.5"
            style={{ background: C.panel, borderBottom: `1px solid ${C.border}` }}
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="font-mono uppercase tracking-widest rounded-t-xl px-6 py-2 transition-all"
                style={{
                  fontSize: 9,
                  letterSpacing: "0.22em",
                  color: tab === t.id ? C.accent : C.dim,
                  background: tab === t.id ? C.bg : "transparent",
                  borderTop: `1px solid ${tab === t.id ? C.border : "transparent"}`,
                  borderLeft: `1px solid ${tab === t.id ? C.border : "transparent"}`,
                  borderRight: `1px solid ${tab === t.id ? C.border : "transparent"}`,
                  borderBottom: tab === t.id ? `1px solid ${C.bg}` : "1px solid transparent",
                  marginBottom: -1,
                }}
                data-testid={`tab-${t.id}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Channels ── */}
          {tab === "channels" && (
            <div
              className="flex overflow-x-auto overflow-y-hidden flex-1"
              style={{ scrollbarWidth: "thin", scrollbarColor: `${C.border} transparent`, alignItems: "flex-start" }}
            >
              {CH_DEFS.map((ch) => (
                <ChannelStrip
                  key={ch.label}
                  label={ch.label}
                  color={ch.color}
                  position={ch.getPos(mixState)}
                  on={ch.getOn(mixState)}
                  level={ch.getLvl(mixState)}
                  faderH={faderH}
                  onFader={(v) => setFader(ch.attr, ch.ch, v)}
                  onToggle={() => toggleOn(ch.attr, ch.ch, ch.getOn(mixState))}
                />
              ))}
            </div>
          )}

          {/* ── Matrix ── */}
          {tab === "matrix" && (
            <div className="flex-1 overflow-hidden">
              <MatrixGrid
                mixState={mixState}
                onToggleInput={toggleInputMatrix}
                onToggleOutput={toggleOutputMatrix}
                onSetGain={setInputGain}
              />
            </div>
          )}

          {/* ── Presets ── */}
          {tab === "presets" && (
            <div className="flex-1 overflow-hidden">
              <PresetsPanel
                currentPreset={mixState.currentPreset}
                onLoad={loadPreset}
                onStore={storePreset}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
