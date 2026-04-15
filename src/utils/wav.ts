/**
 * Minimal PCM → WAV wrapper. Gemini's TTS returns raw 16-bit signed PCM at
 * a declared sample rate (mimeType "audio/L16;codec=pcm;rate=24000"); most
 * players don't handle headerless PCM. This writes a standard RIFF header
 * so files play in every media app.
 */

export interface PcmFormat {
  sampleRate: number
  channels: number
  /** Bits per sample. 16 is the only value Gemini currently returns. */
  bitsPerSample: number
}

/** Parse `audio/L16;codec=pcm;rate=24000` into a PcmFormat. */
export function parsePcmMime(mime: string): PcmFormat {
  const rate = /rate=(\d+)/.exec(mime)?.[1]
  return {
    sampleRate: rate ? Number(rate) : 24000,
    channels: 1,
    bitsPerSample: 16,
  }
}

/**
 * Wrap raw PCM bytes into a self-contained WAV file. Returns a new buffer
 * with the 44-byte RIFF header followed by the PCM payload.
 */
export function wrapPcmAsWav(pcm: Uint8Array, fmt: PcmFormat): Uint8Array {
  const header = new Uint8Array(44)
  const view = new DataView(header.buffer)
  const byteRate = fmt.sampleRate * fmt.channels * (fmt.bitsPerSample / 8)
  const blockAlign = fmt.channels * (fmt.bitsPerSample / 8)
  const dataSize = pcm.byteLength

  // "RIFF" <size> "WAVE"
  writeStr(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(view, 8, 'WAVE')

  // "fmt " subchunk
  writeStr(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // PCM fmt chunk size
  view.setUint16(20, 1, true) // audio format = PCM
  view.setUint16(22, fmt.channels, true)
  view.setUint32(24, fmt.sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, fmt.bitsPerSample, true)

  // "data" subchunk
  writeStr(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  const out = new Uint8Array(44 + dataSize)
  out.set(header, 0)
  out.set(pcm, 44)
  return out
}

function writeStr(view: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
}
