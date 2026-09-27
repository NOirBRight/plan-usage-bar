import { describe, expect, it } from 'vitest'
import { disallowedImportSpecifiers } from '../scripts/scan-engine-imports.ts'

describe('engine release import scan', () => {
  it('accepts a node: import and rejects a bare import in one fixture', () => {
    const fixture = [
      'import { readFile } from "node:fs/promises"',
      'import leftPad from "left-pad"',
    ].join('\n')
    expect(disallowedImportSpecifiers(fixture)).toEqual(['left-pad'])
  })
})
