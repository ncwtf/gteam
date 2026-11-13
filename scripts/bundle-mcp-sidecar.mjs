#!/usr/bin/env node
/**
 * Build a Node single-executable gteam MCP sidecar for Tauri externalBin.
 * The installed app launches this binary directly, so end users do not need
 * Node.js or a source checkout.
 *
 *   node scripts/bundle-mcp-sidecar.mjs              # always rebuild
 *   node scripts/bundle-mcp-sidecar.mjs --if-missing # skip fresh outputs
 *
 * Tauri sets TAURI_ENV_TARGET_TRIPLE for beforeBuildCommand. On macOS without
 * that variable, both darwin architectures are produced.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { inject } from 'postject';

export const NODE_VERSION = '22.23.4';
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tauriDir = path.join(repoRoot, 'apps/desktop/src-tauri');
const binariesDir = path.join(tauriDir, 'binaries');
const cacheDir = path.join(tauriDir, '.mcp-cache');
const sourceFiles = [
  path.join(repoRoot, 'packages/mcp-server/src/cli.ts'),
  path.join(repoRoot, 'packages/mcp-server/src/index.ts'),
];

/** Rust target triple → official Node.js distribution. */
export const NODE_ASSETS = {
  'x86_64-unknown-linux-gnu': { archive: 'linux-x64.tar.gz', binary: 'bin/node' },
  'aarch64-unknown-linux-gnu': { archive: 'linux-arm64.tar.gz', binary: 'bin/node' },
  'x86_64-apple-darwin': { archive: 'darwin-x64.tar.gz', binary: 'bin/node' },
  'aarch64-apple-darwin': { archive: 'darwin-arm64.tar.gz', binary: 'bin/node' },
  'x86_64-pc-windows-msvc': { archive: 'win-x64.zip', binary: 'node.exe' },
  'aarch64-pc-windows-msvc': { archive: 'win-arm64.zip', binary: 'node.exe' },
};

export function outputFileName(triple) {
  const ext = triple.includes('windows') ? '.exe' : '';
  return `gteam-mcp-${triple}${ext}`;
}

export function hostTriple() {
  if (process.platform === 'win32') {
    return process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  }
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  }
  return process.arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
}

export function triplesToBuild(env = process.env) {
  const requested = env.TAURI_ENV_TARGET_TRIPLE;
  if (requested) {
    if (!NODE_ASSETS[requested]) {
      throw new Error(`不支持的目标架构: ${requested}`);
    }
    return [requested];
  }
  if (process.platform === 'darwin') {
    return ['aarch64-apple-darwin', 'x86_64-apple-darwin'];
  }
  return [hostTriple()];
}

function distFolderName(triple) {
  return `node-v${NODE_VERSION}-${NODE_ASSETS[triple].archive.replace(/\.tar\.gz$|\.zip$/, '')}`;
}

async function download(url, dest) {
  if (existsSync(dest) && statSync(dest).size > 0) return;
  mkdirSync(path.dirname(dest), { recursive: true });
  const partial = `${dest}.partial`;
  console.log(`下载 ${url}`);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`下载失败 ${response.status} ${url}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  renameSync(partial, dest);
}

function extractArchive(archive, destDir) {
  mkdirSync(destDir, { recursive: true });
  const result = spawnSync('tar', ['-xf', archive, '-C', destDir], { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`解压失败: ${archive}`);
  }
}

async function nodeBinary(triple) {
  const asset = NODE_ASSETS[triple];
  const archivePath = path.join(cacheDir, `node-v${NODE_VERSION}-${asset.archive}`);
  const folder = path.join(cacheDir, distFolderName(triple));
  const binary = path.join(folder, asset.binary);
  if (!existsSync(binary)) {
    const url = `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${asset.archive}`;
    await download(url, archivePath);
    rmSync(folder, { recursive: true, force: true });
    extractArchive(archivePath, cacheDir);
  }
  if (!existsSync(binary)) {
    throw new Error(`Node 二进制不在预期路径: ${binary}`);
  }
  return binary;
}

async function bundleScript() {
  const outfile = path.join(cacheDir, 'mcp-cli.cjs');
  mkdirSync(cacheDir, { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(repoRoot, 'packages/mcp-server/src/cli.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile,
    legalComments: 'none',
    external: ['bufferutil', 'utf-8-validate'],
    plugins: [
      {
        name: 'resolve-ts-js-specifier',
        setup(build) {
          build.onResolve({ filter: /^\.{1,2}\/.*\.js$/ }, (args) => {
            const base = path.resolve(args.resolveDir, args.path.slice(0, -3));
            for (const ext of ['.ts', '.tsx', '.js', '.mjs', '.cjs']) {
              const candidate = base + ext;
              if (existsSync(candidate)) return { path: candidate };
            }
            return null;
          });
        },
      },
    ],
  });
  return outfile;
}

function generateBlob(nodeBin, scriptPath) {
  const configPath = path.join(cacheDir, 'sea-config.json');
  const blobPath = path.join(cacheDir, 'sea-prep.blob');
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        main: scriptPath,
        output: blobPath,
        disableExperimentalSEAWarning: true,
      },
      null,
      2,
    ),
  );
  const result = spawnSync(nodeBin, ['--experimental-sea-config', configPath], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error('生成 Node SEA blob 失败');
  }
  return blobPath;
}

function needsCodesign(triple) {
  return triple.includes('apple-darwin');
}

async function injectBlob(nodeBin, blobPath, triple) {
  mkdirSync(binariesDir, { recursive: true });
  const outfile = path.join(binariesDir, outputFileName(triple));
  copyFileSync(nodeBin, outfile);
  chmodSync(outfile, 0o755);
  if (needsCodesign(triple)) {
    if (process.platform !== 'darwin') {
      throw new Error(`给 ${triple} 注入 SEA 需要在 macOS 上 codesign`);
    }
    const removed = spawnSync('codesign', ['--remove-signature', outfile], { stdio: 'inherit' });
    if (removed.status !== 0) throw new Error(`codesign --remove-signature 失败: ${outfile}`);
  }
  await inject(outfile, 'NODE_SEA_BLOB', readFileSync(blobPath), {
    sentinelFuse: SEA_FUSE,
    machoSegmentName: 'NODE_SEA',
  });
  chmodSync(outfile, 0o755);
  if (needsCodesign(triple)) {
    const signed = spawnSync('codesign', ['--sign', '-', outfile], { stdio: 'inherit' });
    if (signed.status !== 0) throw new Error(`codesign --sign - 失败: ${outfile}`);
  }
  return outfile;
}

function isUpToDate(outfile) {
  if (!existsSync(outfile)) return false;
  const built = statSync(outfile).mtimeMs;
  return sourceFiles.every((file) => existsSync(file) && statSync(file).mtimeMs <= built);
}

export async function buildSidecars({ ifMissing = false } = {}) {
  const triples = triplesToBuild();
  const pending = triples.filter((triple) => {
    const outfile = path.join(binariesDir, outputFileName(triple));
    return !(ifMissing && isUpToDate(outfile));
  });
  if (pending.length === 0) {
    console.log('gteam MCP sidecar 已是最新，跳过构建');
    return [];
  }

  const scriptPath = await bundleScript();
  const runnable = await nodeBinary(hostTriple());
  const blobPath = generateBlob(runnable, scriptPath);
  const outputs = [];
  for (const triple of pending) {
    const nodeBin = triple === hostTriple() ? runnable : await nodeBinary(triple);
    const outfile = await injectBlob(nodeBin, blobPath, triple);
    console.log(`已生成 ${outfile}`);
    outputs.push(outfile);
  }
  return outputs;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const ifMissing = process.argv.includes('--if-missing');
  buildSidecars({ ifMissing }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
