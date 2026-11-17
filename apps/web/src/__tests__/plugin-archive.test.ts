import { gzipSync } from 'node:zlib';
import { expect, test } from 'vitest';
import { inspectPluginArchive } from '../lib/plugin-archive';
function archive(extra?: [string, string]) {
  const files: [string, string][] = [
    ['package/package.json', '{"name":"test-plugin","version":"1.0.0"}'],
    ['package/index.js', 'export function apply() {}'],
  ];
  if (extra) files.push(extra);
  const blocks: Buffer[] = [];
  for (const [name, content] of files) {
    const data = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(name);
    header.write('0000600\0', 100);
    header.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
    header[156] = 48;
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return new File([new Uint8Array(gzipSync(Buffer.concat(blocks)))], 'plugin.tgz');
}
test('local preview inspects the exact archive and refuses private content before upload', async () => {
  const preview = await inspectPluginArchive(archive());
  expect(preview.package).toBe('test-plugin');
  expect(preview.files).toContain('package/index.js');
  expect(preview.sha256).toMatch(/^[a-f0-9]{64}$/);
  await expect(inspectPluginArchive(archive(['package/.env', 'SECRET=value']))).rejects.toThrow();
  await expect(
    inspectPluginArchive(archive(['package/key.txt', '-----BEGIN PRIVATE KEY-----'])),
  ).rejects.toThrow();
  await expect(inspectPluginArchive(archive(['package/../outside', 'bad']))).rejects.toThrow();
});
