import { describe, expect, it } from 'vitest'
import { parsePcmMime, wrapPcmAsWav } from './wav.js'

describe('parsePcmMime', () => {
  it('extracts sample rate from Gemini-style mime', () => {
    expect(parsePcmMime('audio/L16;codec=pcm;rate=24000')).toEqual({
      sampleRate: 24000,
      channels: 1,
      bitsPerSample: 16,
    })
  })

  it('falls back to 24000 when rate missing', () => {
    expect(parsePcmMime('audio/L16;codec=pcm').sampleRate).toBe(24000)
  })
})

describe('wrapPcmAsWav', () => {
  it('produces a valid 44-byte RIFF header + data', () => {
    const pcm = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])
    const wav = wrapPcmAsWav(pcm, { sampleRate: 24000, channels: 1, bitsPerSample: 16 })
    expect(wav.byteLength).toBe(44 + 8)

    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
    // "RIFF"
    expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe('RIFF')
    // file size = 36 + dataLen
    expect(view.getUint32(4, true)).toBe(36 + 8)
    // "WAVE"
    expect(String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11))).toBe('WAVE')
    // "fmt "
    expect(String.fromCharCode(view.getUint8(12), view.getUint8(13), view.getUint8(14), view.getUint8(15))).toBe('fmt ')
    // PCM format
    expect(view.getUint16(20, true)).toBe(1)
    // Channels
    expect(view.getUint16(22, true)).toBe(1)
    // Sample rate
    expect(view.getUint32(24, true)).toBe(24000)
    // "data"
    expect(String.fromCharCode(view.getUint8(36), view.getUint8(37), view.getUint8(38), view.getUint8(39))).toBe('data')
    expect(view.getUint32(40, true)).toBe(8)
    // Payload preserved
    expect(Array.from(wav.slice(44))).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('scales byteRate and blockAlign correctly for stereo', () => {
    const wav = wrapPcmAsWav(new Uint8Array(0), { sampleRate: 48000, channels: 2, bitsPerSample: 16 })
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
    expect(view.getUint16(22, true)).toBe(2) // channels
    expect(view.getUint32(24, true)).toBe(48000) // sample rate
    expect(view.getUint32(28, true)).toBe(48000 * 2 * 2) // byte rate
    expect(view.getUint16(32, true)).toBe(2 * 2) // block align
  })
})
