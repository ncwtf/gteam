import fs from 'node:fs';
import path from 'node:path';

const TARGETS = [
  { triple: 'aarch64-apple-darwin', platform: 'darwin-aarch64', arch: 'aarch64' },
  { triple: 'x86_64-apple-darwin', platform: 'darwin-x86_64', arch: 'x86_64' },
  { triple: 'x86_64-pc-windows-msvc', platform: 'windows-x86_64', arch: 'x86_64' },
  { triple: 'x86_64-unknown-linux-gnu', platform: 'linux-x86_64', arch: 'x86_64' },
];

const REQUIRED_PLATFORMS = [
  'darwin-aarch64',
  'darwin-x86_64',
  'windows-x86_64',
  'linux-x86_64',
];

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) {
    console.error(`missing ${name}`);
    process.exit(1);
  }
  return process.argv[index + 1];
}

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function targetOf(file) {
  const parts = file.split(path.sep);
  return TARGETS.find((target) => parts.some((part) => part.includes(target.triple)));
}

function isMacTar(name) {
  return name.endsWith('.app.tar.gz');
}

function isSetupExe(name) {
  return name.endsWith('-setup.exe');
}

function isAppImage(name) {
  return name.endsWith('.AppImage');
}

function isUpdaterBundle(name) {
  return isMacTar(name) || isSetupExe(name) || isAppImage(name);
}

function isReleaseAsset(name) {
  return isUpdaterBundle(name)
    || name.endsWith('.dmg')
    || name.endsWith('.msi')
    || name.endsWith('.deb')
    || name.endsWith('.rpm');
}

function insertArch(filename, arch) {
  if (filename.includes(`_${arch}`) || filename.includes(`-${arch}`)) return filename;
  if (filename.endsWith('.app.tar.gz.sig')) {
    return `${filename.slice(0, -'.app.tar.gz.sig'.length)}_${arch}.app.tar.gz.sig`;
  }
  if (filename.endsWith('.app.tar.gz')) {
    return `${filename.slice(0, -'.app.tar.gz'.length)}_${arch}.app.tar.gz`;
  }
  if (filename.endsWith('.AppImage.sig')) {
    return `${filename.slice(0, -'.AppImage.sig'.length)}_${arch}.AppImage.sig`;
  }
  if (filename.endsWith('.AppImage')) {
    return `${filename.slice(0, -'.AppImage'.length)}_${arch}.AppImage`;
  }
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return `${filename}_${arch}`;
  return `${filename.slice(0, dot)}_${arch}${filename.slice(dot)}`;
}

function readSignature(file) {
  const signature = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!signature) {
    throw new Error(`empty signature: ${file}`);
  }
  return signature;
}

function stage() {
  const dist = arg('--dist');
  const out = arg('--out');
  const manifestPath = arg('--manifest');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const used = new Set();
  const platforms = {};

  function allocate(name, arch) {
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
    const renamed = insertArch(name, arch);
    if (renamed === name || used.has(renamed)) {
      throw new Error(`release asset filename collision: ${name}`);
    }
    console.log(`renamed colliding asset ${name} -> ${renamed}`);
    used.add(renamed);
    return renamed;
  }

  const files = walk(dist);
  for (const file of files) {
    const filename = path.basename(file);
    if (!isReleaseAsset(filename)) continue;
    const target = targetOf(file);
    const arch = target ? target.arch : 'unknown';
    let assetName = isMacTar(filename) ? insertArch(filename, arch) : filename;
    assetName = allocate(assetName, arch);
    fs.copyFileSync(file, path.join(out, assetName));

    const sigSource = `${file}.sig`;
    let signature;
    if (fs.existsSync(sigSource)) {
      const sigName = allocate(`${assetName}.sig`, arch);
      if (sigName !== `${assetName}.sig`) {
        throw new Error(`signature filename drifted from ${assetName}: ${sigName}`);
      }
      fs.copyFileSync(sigSource, path.join(out, sigName));
      signature = readSignature(sigSource);
    } else if (isUpdaterBundle(filename)) {
      throw new Error(`missing updater signature for ${file}`);
    }

    if (!isUpdaterBundle(filename)) continue;
    if (!target) throw new Error(`updater bundle has no known target: ${file}`);
    if (platforms[target.platform]) {
      throw new Error(`duplicate updater bundle for ${target.platform}: ${file}`);
    }
    platforms[target.platform] = { file: assetName, signature };
    console.log(`${target.platform} -> ${assetName}`);
  }

  for (const platform of REQUIRED_PLATFORMS) {
    if (!platforms[platform]) {
      throw new Error(`missing updater artifact for ${platform}`);
    }
  }

  fs.writeFileSync(manifestPath, `${JSON.stringify(platforms, null, 2)}\n`);
  console.log(`staged ${used.size} files into ${out}`);
}

function latest() {
  const manifest = JSON.parse(fs.readFileSync(arg('--manifest'), 'utf8'));
  const version = arg('--version').replace(/^v/, '');
  const tag = arg('--tag');
  const repo = arg('--repo');
  const notes = fs.readFileSync(arg('--notes-file'), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
  const platforms = {};
  for (const platform of REQUIRED_PLATFORMS) {
    const entry = manifest[platform];
    if (!entry?.file || !entry.signature) {
      throw new Error(`manifest missing ${platform}`);
    }
    platforms[platform] = {
      signature: entry.signature,
      url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(entry.file)}`,
    };
  }
  const body = {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms,
  };
  fs.writeFileSync(arg('--out'), `${JSON.stringify(body, null, 2)}\n`);
  console.log(`wrote latest.json for ${version}`);
}

const command = process.argv[2];
try {
  if (command === 'stage') stage();
  else if (command === 'latest') latest();
  else {
    console.error('usage: release-updater.mjs <stage|latest> ...');
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
