import assert from 'node:assert/strict';
import test from 'node:test';
import { hostTriple, NODE_ASSETS, outputFileName, triplesToBuild } from './bundle-mcp-sidecar.mjs';

test('every desktop target maps to a node archive and a tauri sidecar name', () => {
  for (const triple of Object.keys(NODE_ASSETS)) {
    assert.match(outputFileName(triple), new RegExp(`^gteam-mcp-${triple}(\\.exe)?$`));
    if (triple.includes('windows')) assert.match(outputFileName(triple), /\.exe$/);
    else assert.equal(outputFileName(triple).endsWith('.exe'), false);
  }
});

test('TAURI_ENV_TARGET_TRIPLE selects a single sidecar', () => {
  assert.deepEqual(triplesToBuild({ TAURI_ENV_TARGET_TRIPLE: 'x86_64-unknown-linux-gnu' }), [
    'x86_64-unknown-linux-gnu',
  ]);
  assert.deepEqual(triplesToBuild({ TAURI_ENV_TARGET_TRIPLE: 'aarch64-apple-darwin' }), [
    'aarch64-apple-darwin',
  ]);
  assert.throws(() => triplesToBuild({ TAURI_ENV_TARGET_TRIPLE: 'wasm32-unknown-unknown' }));
});

test('host triple is one this machine can run', () => {
  assert.ok(NODE_ASSETS[hostTriple()]);
});
