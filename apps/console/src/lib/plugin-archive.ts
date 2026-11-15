/** Inspect a selected archive locally before any bytes leave the browser. */
export interface PluginPreview {
  package: string;
  version: string;
  files: string[];
  sha256: string;
  size: number;
}
export async function inspectPluginArchive(file: File): Promise<PluginPreview> {
  if (file.size > 10 * 1024 * 1024) throw Error('invalid_archive');
  const reader = file.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 64 * 1024 * 1024) throw Error('invalid_archive');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  const data = new Uint8Array(size);
  let cursor = 0;
  for (const chunk of chunks) {
    data.set(chunk, cursor);
    cursor += chunk.length;
  }
  const decoder = new TextDecoder();
  const text = (start: number, len: number) =>
    decoder.decode(data.subarray(start, start + len)).split('\0')[0];
  if (
    /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}/.test(
      decoder.decode(data),
    )
  )
    throw Error('invalid_archive');
  const files: string[] = [];
  const seen = new Set<string>();
  let manifest: { name?: string; version?: string } = {};
  for (let offset = 0; offset + 512 <= data.length; ) {
    if (data.subarray(offset, offset + 512).every((v) => v === 0)) {
      if (!data.subarray(offset).every((v) => v === 0)) throw Error('invalid_archive');
      break;
    }
    const prefix = text(offset + 345, 155);
    const name = (prefix ? `${prefix}/` : '') + text(offset, 100);
    const count = Number.parseInt(text(offset + 124, 12).trim(), 8);
    const type = text(offset + 156, 1);
    if (
      !Number.isFinite(count) ||
      count < 0 ||
      offset + 512 + count > data.length ||
      seen.size >= 2000 ||
      seen.has(name) ||
      !name.startsWith('package/') ||
      name.includes('..') ||
      name.includes('\\') ||
      name.includes(':') ||
      !['', '0', '5'].includes(type)
    )
      throw Error('invalid_archive');
    const base = name.split('/').at(-1)?.toLowerCase() ?? '';
    if (
      base === '.env' ||
      base.startsWith('.env.') ||
      ['.npmrc', '.netrc'].includes(base) ||
      /\.(pem|key)$/.test(base) ||
      name.includes('/.aws/') ||
      name.includes('/.ssh/') ||
      name.includes('/.git/')
    )
      throw Error('invalid_archive');
    seen.add(name);
    if (type !== '5') {
      files.push(name);
      if (name === 'package/package.json')
        manifest = JSON.parse(
          decoder.decode(data.subarray(offset + 512, offset + 512 + count)),
        ) as typeof manifest;
    }
    offset += 512 + Math.ceil(count / 512) * 512;
  }
  if (!manifest.name || !manifest.version) throw Error('invalid_archive');
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return {
    package: manifest.name,
    version: manifest.version,
    files,
    sha256: Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join(''),
    size: file.size,
  };
}
