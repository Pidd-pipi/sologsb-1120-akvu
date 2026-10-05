// store 级端到端验证：fake-indexeddb + 真实 Dexie 事务
import { build } from 'esbuild';

const result = await build({
  entryPoints: ['scripts/_e2e-body.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
});
const code = result.outputFiles[0].text;
const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
await import(dataUrl);
