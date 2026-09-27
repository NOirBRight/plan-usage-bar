import { chmod, mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Replace `path` via a pid temp file. `mode` is applied after write so umask cannot widen it. */
export async function writeAtomic(path: string, contents: string, mode?: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${String(process.pid)}.tmp`
  try {
    await writeFile(tmp, contents, mode === undefined ? undefined : { mode })
    if (mode !== undefined)
      await chmod(tmp, mode)
    await rename(tmp, path)
  } catch (error) {
    await unlink(tmp).catch(() => undefined)
    throw error
  }
}
