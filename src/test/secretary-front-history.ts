import path from 'node:path';
import { createHash } from 'node:crypto';
/** Source-byte replay for sealed pre-Front evidence, never used by live runners. */
export function frontHistoricalFs(actual: typeof import('node:fs')): typeof actual.readFileSync {
  const archive = JSON.parse(actual.readFileSync('src/test/fixtures/secretary-front-predecessor.json', 'utf8')) as Record<string, string>;
  const manifest = JSON.parse(actual.readFileSync('packages/salon-secretary/evaluation/results/topic14-final/real-manifest.json', 'utf8'));
  for (const [file, bytes] of Object.entries(archive)) {
    if (createHash('sha256').update(bytes).digest('hex') !== manifest.source_hashes[file]) throw Error('INVALID_PRE_FRONT_ARCHIVE');
  }
  return ((file: Parameters<typeof actual.readFileSync>[0], options?: unknown) => {
    const key = typeof file === 'string' ? path.relative(process.cwd(), path.resolve(file)).replaceAll('\\', '/') : '';
    const source = archive[key];
    if (source === undefined) return actual.readFileSync(file, options as Parameters<typeof actual.readFileSync>[1]);
    const encoding = typeof options === 'string' ? options : options && typeof options === 'object' && 'encoding' in options ? options.encoding : null;
    return encoding ? Buffer.from(source).toString(encoding as BufferEncoding) : Buffer.from(source);
  }) as typeof actual.readFileSync;
}
