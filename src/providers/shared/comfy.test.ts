import { describe, expect, it } from 'vitest'
import { collectOutputFiles, substituteWorkflow, type HistoryEntry } from './comfy.js'

describe('substituteWorkflow', () => {
  it('replaces $VAR tokens', () => {
    const out = substituteWorkflow('{"text":"$PROMPT"}', { PROMPT: 'hello' })
    expect(out).toBe('{"text":"hello"}')
  })

  it('leaves unknown placeholders alone', () => {
    const out = substituteWorkflow('$KEEP and $GONE', { GONE: 'x' })
    expect(out).toBe('$KEEP and x')
  })

  it('coerces numbers to strings', () => {
    const out = substituteWorkflow('{"w":$WIDTH}', { WIDTH: 1024 })
    expect(out).toBe('{"w":1024}')
  })
})

describe('collectOutputFiles', () => {
  it('flattens images/videos/gifs/audio across nodes in id order', () => {
    const entry: HistoryEntry = {
      outputs: {
        '20': {
          videos: [{ filename: 'v1.mp4', subfolder: '', type: 'output' }],
        },
        '9': {
          images: [
            { filename: 'a.png', subfolder: '', type: 'output' },
            { filename: 'b.png', subfolder: '', type: 'output' },
          ],
        },
      },
    }
    const files = collectOutputFiles(entry)
    // Keys sorted lexicographically: '20' < '9' when compared as strings.
    expect(files.map((f) => f.filename)).toEqual(['v1.mp4', 'a.png', 'b.png'])
  })
})
