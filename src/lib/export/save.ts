import { api } from "../ipc";

/** Ask for a location (native dialog in Tauri) and write bytes. Returns the path or null when cancelled. */
export async function saveBytes(defaultName: string, data: Uint8Array, filter: { name: string; extensions: string[] }): Promise<string | null> {
  const path = await api().saveDialog(defaultName, [filter]);
  if (!path) return null;
  await api().writeFile(path, data);
  return path;
}

export const utf8 = (s: string) => new TextEncoder().encode(s);
