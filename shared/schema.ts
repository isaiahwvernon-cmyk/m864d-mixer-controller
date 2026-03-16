import { z } from "zod";

export const mixerConfigSchema = z.object({
  ip: z.string().min(1, "IP address is required"),
  port: z.number().int().min(1).max(65535).default(3000),
});
export type MixerConfig = z.infer<typeof mixerConfigSchema>;

export interface MixerState {
  connected: boolean;
  ip: string;
  port: number;
  remoteMode: boolean | null;
  currentPreset: number;
  monoInFader: number[];
  stereoInFader: number[];
  monoOutFader: number[];
  recOutFader: number[];
  monoInOn: boolean[];
  stereoInOn: boolean[];
  monoOutOn: boolean[];
  recOutOn: boolean[];
  inputMatrix: boolean[][];
  inputMatrixGain: number[][];
  outputMatrix: boolean[][];
  monoInLevel: number[];
  stereoInLevel: number[];
  monoOutLevel: number[];
}

export function defaultMixerState(): MixerState {
  return {
    connected: false,
    ip: "",
    port: 3000,
    remoteMode: null,
    currentPreset: 0,
    monoInFader: Array(8).fill(0x35),
    stereoInFader: Array(2).fill(0x35),
    monoOutFader: Array(4).fill(0x35),
    recOutFader: Array(2).fill(0x35),
    monoInOn: Array(8).fill(true),
    stereoInOn: Array(2).fill(true),
    monoOutOn: Array(4).fill(true),
    recOutOn: Array(2).fill(true),
    inputMatrix: Array(10).fill(null).map(() => Array(4).fill(false)),
    inputMatrixGain: Array(10).fill(null).map(() => Array(4).fill(0x46)),
    outputMatrix: Array(4).fill(null).map(() => Array(2).fill(false)),
    monoInLevel: Array(8).fill(0),
    stereoInLevel: Array(4).fill(0),
    monoOutLevel: Array(4).fill(0),
  };
}

export const FADER_GAIN_TABLE: number[] = [
  -Infinity,
  -69, -66, -63, -60, -58, -56, -54, -52, -50,
  -48, -46, -44, -42, -40, -38,
  -37, -36, -35, -34, -33, -32, -31, -30, -29, -28, -27, -26, -25, -24, -23, -22,
  -21, -20, -19, -18, -17, -16, -15, -14, -13, -12, -11, -10, -9, -8, -7, -6,
  -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
];

export const CROSSPOINT_GAIN_TABLE: number[] = [
  -Infinity,
  -69, -68, -67, -66, -65, -64, -63, -62, -61, -60,
  -59, -58, -57, -56, -55, -54, -53, -52, -51, -50,
  -49, -48, -47, -46, -45, -44, -43, -42, -41, -40,
  -39, -38, -37, -36, -35, -34, -33, -32, -31, -30,
  -29, -28, -27, -26, -25, -24, -23, -22, -21, -20,
  -19, -18, -17, -16, -15, -14, -13, -12, -11, -10,
  -9, -8, -7, -6, -5, -4, -3, -2, -1, 0
];

export const LEVEL_METER_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let i = 0; i <= 72; i++) {
    t.push(i - 48);
  }
  return t;
})();

export function faderPositionToDb(pos: number): number {
  if (pos < 0 || pos > 63) return -Infinity;
  return FADER_GAIN_TABLE[pos];
}

export function crosspointValueToDb(val: number): number {
  if (val < 0 || val > 70) return -Infinity;
  return CROSSPOINT_GAIN_TABLE[val];
}

export function formatDb(db: number): string {
  if (!isFinite(db)) return "-∞";
  if (db === 0) return "0";
  return db > 0 ? `+${db}` : `${db}`;
}
