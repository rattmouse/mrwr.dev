/**
 * Sun/NeXT .au → WAV, in the browser. Hardly any browser plays audio/basic, so
 * player.exe decodes the file itself and hands the <video> element a 16-bit
 * PCM WAV instead. Covers every encoding anyone actually ships .au in:
 * μ-law, A-law, 8/16/24/32-bit linear PCM and 32/64-bit float.
 */

const MAGIC = 0x2e736e64; // ".snd"

function ulawToLinear(u: number) {
  u = ~u & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let sample = (((mantissa << 3) + 0x84) << exponent) - 0x84;
  if (sign) sample = -sample;
  return sample;
}

function alawToLinear(a: number) {
  a ^= 0x55;
  const sign = a & 0x80;
  const exponent = (a >> 4) & 0x07;
  const mantissa = a & 0x0f;
  let sample = exponent === 0 ? (mantissa << 4) + 8 : ((mantissa << 4) + 0x108) << (exponent - 1);
  if (!sign) sample = -sample;
  return sample;
}

const clamp16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)));

export function isAuName(name: string) {
  return /\.(au|snd)$/i.test(name);
}

export async function auToWav(file: Blob): Promise<Blob> {
  const buf = await file.arrayBuffer();
  const view = new DataView(buf);
  if (buf.byteLength < 24 || view.getUint32(0) !== MAGIC) throw new Error("not a .au file");

  const offset = view.getUint32(4);
  const declared = view.getUint32(8);
  const encoding = view.getUint32(12);
  const rate = view.getUint32(16);
  const channels = view.getUint32(20);
  if (!rate || !channels || offset > buf.byteLength) throw new Error("bad .au header");

  const available = buf.byteLength - offset;
  const size = declared === 0xffffffff ? available : Math.min(declared, available);

  const bytesPer: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 3, 5: 4, 6: 4, 7: 8, 27: 1 };
  const width = bytesPer[encoding];
  if (!width) throw new Error(`unsupported .au encoding ${encoding}`);

  const count = Math.floor(size / width);
  const out = new ArrayBuffer(44 + count * 2);
  const w = new DataView(out);

  const str = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) w.setUint8(at + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  w.setUint32(4, 36 + count * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  w.setUint32(16, 16, true);
  w.setUint16(20, 1, true);
  w.setUint16(22, channels, true);
  w.setUint32(24, rate, true);
  w.setUint32(28, rate * channels * 2, true);
  w.setUint16(32, channels * 2, true);
  w.setUint16(34, 16, true);
  str(36, "data");
  w.setUint32(40, count * 2, true);

  // .au samples are big-endian; WAV wants little-endian.
  for (let i = 0; i < count; i++) {
    const at = offset + i * width;
    let s: number;
    switch (encoding) {
      case 1: s = ulawToLinear(view.getUint8(at)); break;
      case 27: s = alawToLinear(view.getUint8(at)); break;
      case 2: s = view.getInt8(at) << 8; break;
      case 3: s = view.getInt16(at); break;
      case 4: s = ((view.getInt8(at) << 16) | (view.getUint8(at + 1) << 8) | view.getUint8(at + 2)) >> 8; break;
      case 5: s = view.getInt32(at) >> 16; break;
      case 6: s = clamp16(view.getFloat32(at) * 32767); break;
      default: s = clamp16(view.getFloat64(at) * 32767); break;
    }
    w.setInt16(44 + i * 2, s, true);
  }

  return new Blob([out], { type: "audio/wav" });
}
