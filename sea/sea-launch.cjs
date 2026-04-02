/**
 * SEA (Single Executable Application) launcher for APEX.
 *
 * Extracts the embedded ESM bundle to a versioned temp directory and
 * dynamically imports it.  Based on the gemini-cli launcher but
 * simplified for APEX single-file bundle (no code-splitting).
 */
const { getAsset } = require('node:sea');
const process = require('node:process');
const nodeModule = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');

function sanitizeArgv(argv, execPath, resolveFn = path.resolve) {
  if (argv.length > 2) {
    const arg2Abs = resolveFn(argv[2]);
    if (execPath === arg2Abs) {
      argv.splice(2, 1);
      return true;
    }
  }
  return false;
}

function getSafeName(name) {
  return (name || 'unknown').toString().replace(/[^a-zA-Z0-9.-]/g, '_');
}

function verifyIntegrity(dir, manifest, fsMod = fs, cryptoMod = crypto) {
  try {
    const calculateHash = (filePath) => {
      const hash = cryptoMod.createHash('sha256');
      const fd = fsMod.openSync(filePath, 'r');
      const buffer = new Uint8Array(65536);
      try {
        let bytesRead = 0;
        while (
          (bytesRead = fsMod.readSync(fd, buffer, 0, buffer.length, null)) !== 0
        ) {
          hash.update(buffer.subarray(0, bytesRead));
        }
      } finally {
        fsMod.closeSync(fd);
      }
      return hash.digest('hex');
    };

    if (calculateHash(path.join(dir, 'cli.mjs')) !== manifest.mainHash)
      return false;
    if (manifest.files) {
      for (const file of manifest.files) {
        if (calculateHash(path.join(dir, file.path)) !== file.hash)
          return false;
      }
    }
    return true;
  } catch (_e) {
    return false;
  }
}

function prepareRuntime(manifest, getAssetFn, deps = {}) {
  const fsMod = deps.fs || fs;
  const osMod = deps.os || os;
  const pathMod = deps.path || path;
  const processEnv = deps.processEnv || process.env;
  const processPid = deps.processPid || process.pid;
  const processUid =
    deps.processUid || (process.getuid ? process.getuid() : 'unknown');

  const version = manifest.version || '0.0.0';
  const safeVersion = getSafeName(version);
  let username;
  try {
    username = osMod.userInfo().username;
  } catch {
    username = undefined;
  }
  username = username || processEnv.USER || processUid || 'unknown';
  const safeUsername = getSafeName(username);

  const tempBase = osMod.tmpdir();
  const finalRuntimeDir = pathMod.join(
    tempBase,
    `apex-runtime-${safeVersion}-${safeUsername}`,
  );

  let runtimeDir;
  let useExisting = false;

  const isSecure = (dir) => {
    try {
      const stat = fsMod.lstatSync(dir);
      if (!stat.isDirectory()) return false;
      if (processUid !== 'unknown' && stat.uid !== processUid) return false;
      if (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o700)
        return false;
      return true;
    } catch (_) {
      return false;
    }
  };

  if (fsMod.existsSync(finalRuntimeDir)) {
    if (isSecure(finalRuntimeDir)) {
      if (
        verifyIntegrity(finalRuntimeDir, manifest, fsMod, deps.crypto || crypto)
      ) {
        runtimeDir = finalRuntimeDir;
        useExisting = true;
      } else {
        try {
          fsMod.rmSync(finalRuntimeDir, { recursive: true, force: true });
        } catch (_) {}
      }
    } else {
      try {
        fsMod.rmSync(finalRuntimeDir, { recursive: true, force: true });
      } catch (_) {}
    }
  }

  if (!useExisting) {
    const setupDir = pathMod.join(
      tempBase,
      `apex-setup-${processPid}-${Date.now()}`,
    );

    try {
      fsMod.mkdirSync(setupDir, { recursive: true, mode: 0o700 });
      const writeToSetup = (assetKey, relPath) => {
        const content = getAssetFn(assetKey);
        if (!content) return;
        const destPath = pathMod.join(setupDir, relPath);
        const destDir = pathMod.dirname(destPath);
        if (!fsMod.existsSync(destDir))
          fsMod.mkdirSync(destDir, { recursive: true, mode: 0o700 });
        fsMod.writeFileSync(destPath, new Uint8Array(content), {
          mode: 0o755,
        });
      };
      writeToSetup('cli.mjs', 'cli.mjs');
      if (manifest.files) {
        for (const file of manifest.files) {
          writeToSetup(file.key, file.path);
        }
      }
      try {
        fsMod.renameSync(setupDir, finalRuntimeDir);
        runtimeDir = finalRuntimeDir;
      } catch (renameErr) {
        if (
          fsMod.existsSync(finalRuntimeDir) &&
          isSecure(finalRuntimeDir) &&
          verifyIntegrity(
            finalRuntimeDir,
            manifest,
            fsMod,
            deps.crypto || crypto,
          )
        ) {
          runtimeDir = finalRuntimeDir;
          try {
            fsMod.rmSync(setupDir, { recursive: true, force: true });
          } catch (_) {}
        } else {
          throw renameErr;
        }
      }
    } catch (e) {
      console.error(
        'Fatal Error: Failed to setup secure runtime. Please try running again and if error persists please reinstall.',
        e,
      );
      try {
        fsMod.rmSync(setupDir, { recursive: true, force: true });
      } catch (_) {}
      process.exit(1);
    }
  }

  return runtimeDir;
}

function resolveEnvVars(obj) {
  if (typeof obj === 'string' && obj.startsWith('$')) {
    return process.env[obj.slice(1)] || '';
  }
  if (Array.isArray(obj)) return obj.map(resolveEnvVars);
  if (obj !== null && typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      obj[k] = resolveEnvVars(obj[k]);
    }
  }
  return obj;
}

function deployApexAssets(runtimeDir) {
  const configHome =
    process.env.APEX_HOME || process.env.QWEN_CODE_HOME || path.join(os.homedir(), '.apex');
  if (!configHome) return;

  const apexDir = path.join(runtimeDir, 'apex');
  if (!fs.existsSync(apexDir)) return;

  fs.mkdirSync(configHome, { recursive: true });

  const isMac = process.platform === 'darwin';

  const apexMdName = isMac ? 'APEX.mac.md' : 'APEX.md';
  const apexMd = path.join(apexDir, apexMdName);
  const apexMdFallback = path.join(apexDir, 'APEX.md');
  if (fs.existsSync(apexMd)) {
    fs.copyFileSync(apexMd, path.join(configHome, 'APEX.md'));
  } else if (fs.existsSync(apexMdFallback)) {
    fs.copyFileSync(apexMdFallback, path.join(configHome, 'APEX.md'));
  }

  // Settings deployment is handled by npm postinstall (postinstall-apex.js)
  // and the npm launcher (apex-launcher.js). The SEA launcher no longer
  // deploys settings to avoid clobbering user customizations on every launch.
}

async function main(getAssetFn = getAsset) {
  process.env.IS_BINARY = 'true';
  process.env.QWEN_CODE_BRAND = process.env.QWEN_CODE_BRAND || 'APEX';

  if (nodeModule.enableCompileCache) {
    nodeModule.enableCompileCache();
  }

  process.noDeprecation = true;

  sanitizeArgv(process.argv, process.execPath);

  const manifestJson = getAssetFn('manifest.json', 'utf8');
  if (!manifestJson) {
    console.error('Fatal Error: Corrupted binary. Please reinstall.');
    process.exit(1);
  }

  const manifest = JSON.parse(manifestJson);

  const runtimeDir = prepareRuntime(manifest, getAssetFn, {
    fs,
    os,
    path,
    processEnv: process.env,
    crypto,
  });

  // Deploy embedded APEX assets to QWEN_CODE_HOME if present
  deployApexAssets(runtimeDir);

  const mainPath = path.join(runtimeDir, 'cli.mjs');

  await import(pathToFileURL(mainPath).href).catch((err) => {
    console.error('Fatal Error: Failed to launch. Please reinstall.', err);
    console.error(err);
    process.exit(1);
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Unhandled error in sea-launch:', err);
    process.exit(1);
  });
}

module.exports = {
  sanitizeArgv,
  getSafeName,
  verifyIntegrity,
  prepareRuntime,
  resolveEnvVars,
  deployApexAssets,
  main,
};
