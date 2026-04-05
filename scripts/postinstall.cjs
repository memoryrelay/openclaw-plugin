#!/usr/bin/env node
/**
 * Post-install verification and auto-configuration.
 *
 * 1. Verify better-sqlite3 native binary
 * 2. Auto-add to plugins.allow in openclaw.json
 * 3. Auto-sync to ~/.openclaw/extensions/ (where OpenClaw looks first)
 * 4. Restart gateway if it was already running
 */

const path = require('path');
const fs   = require('fs');
const os   = require('os');

// ─── 1. Verify better-sqlite3 ────────────────────────────────────────────────
try {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.prepare('SELECT 1').get();
  db.close();
  console.log('✅ better-sqlite3 native binary OK');
} catch (err) {
  console.warn('⚠️  better-sqlite3 native binary not available — local cache disabled (API-only mode).');
  console.warn('   To enable: npm rebuild better-sqlite3');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
// When installed with `sudo npm install -g`, os.homedir() returns /root.
// Use SUDO_USER or npm_config_cache hints to find the real user's home.
function getRealHome() {
  const sudoUser = process.env.SUDO_USER;
  if (sudoUser && sudoUser !== 'root') {
    // Parse /etc/passwd for the real home dir
    try {
      const passwd = require('fs').readFileSync('/etc/passwd', 'utf8');
      const line = passwd.split('\n').find(l => l.startsWith(sudoUser + ':'));
      if (line) return line.split(':')[5];
    } catch {}
    return path.join('/home', sudoUser);
  }
  return os.homedir();
}

const realHome     = getRealHome();
const configPath     = path.join(realHome, '.openclaw', 'openclaw.json');
const extensionsDir  = path.join(realHome, '.openclaw', 'extensions');
const PLUGIN_NAME    = 'plugin-memoryrelay-ai';
const selfDir        = path.resolve(__dirname, '..');   // root of this package

function readConfig() {
  if (!fs.existsSync(configPath)) return null;
  try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch { return null; }
}

function writeConfig(cfg) {
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n');
}

function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

function isGatewayRunning() {
  try {
    const { execSync } = require('child_process');
    const out = execSync('openclaw gateway status 2>/dev/null || true', { timeout: 5000 }).toString();
    return out.includes('running') || out.includes('active');
  } catch { return false; }
}

function restartGateway() {
  try {
    const { execSync } = require('child_process');
    execSync('openclaw gateway restart 2>/dev/null', { timeout: 15000, stdio: 'ignore' });
    return true;
  } catch { return false; }
}

// ─── 2. Auto-configure plugins.allow ─────────────────────────────────────────
const config = readConfig();
if (config) {
  try {
    if (!config.plugins) config.plugins = {};
    const allow = config.plugins.allow || [];
    if (!allow.includes(PLUGIN_NAME)) {
      allow.push(PLUGIN_NAME);
      config.plugins.allow = allow;
      writeConfig(config);
      console.log('✅ Added plugin-memoryrelay-ai to plugins.allow in OpenClaw config');
    } else {
      console.log('✅ plugin-memoryrelay-ai already in plugins.allow');
    }
  } catch (err) {
    console.warn('⚠️  Could not update plugins.allow:', err.message);
  }
}

// ─── 3. Auto-sync to ~/.openclaw/extensions/ ─────────────────────────────────
// OpenClaw loads plugins from extensions/ first, so global npm installs won't
// take effect unless this directory is in sync.  We copy ourselves there so
// that `npm install -g` is truly plug-and-play with no manual file copying.
try {
  if (!fs.existsSync(extensionsDir)) {
    fs.mkdirSync(extensionsDir, { recursive: true });
  }

  const extTarget = path.join(extensionsDir, PLUGIN_NAME);

  // Check if target already exists and is the same version
  let existingVersion = null;
  const targetPkg = path.join(extTarget, 'package.json');
  if (fs.existsSync(targetPkg)) {
    try { existingVersion = JSON.parse(fs.readFileSync(targetPkg, 'utf8')).version; } catch {}
  }

  const selfVersion = require(path.join(selfDir, 'package.json')).version;

  if (existingVersion === selfVersion) {
    console.log(`✅ extensions/${PLUGIN_NAME} already at v${selfVersion}`);
  } else {
    // Remove stale copy (handles native .node binaries that can't be overwritten)
    if (fs.existsSync(extTarget)) {
      fs.rmSync(extTarget, { recursive: true, force: true });
    }
    copyDirSync(selfDir, extTarget);
    console.log(`✅ Synced plugin to ~/.openclaw/extensions/${PLUGIN_NAME} (v${selfVersion})`);
  }
} catch (err) {
  console.warn('⚠️  Could not sync to extensions/:', err.message);
  console.warn(`   Manually copy this package to ~/.openclaw/extensions/${PLUGIN_NAME}`);
}

// ─── 4. Restart gateway if it was already running ────────────────────────────
// Only restart if we can detect a running gateway — avoid starting it from scratch.
// Skipped when OPENCLAW_POSTINSTALL_NO_RESTART=1 is set (useful for CI/CD).
if (!process.env.OPENCLAW_POSTINSTALL_NO_RESTART) {
  try {
    if (isGatewayRunning()) {
      process.stdout.write('🔄 Restarting OpenClaw gateway to load new version...');
      const ok = restartGateway();
      console.log(ok ? ' done ✅' : ' failed (restart manually: openclaw gateway restart)');
    }
  } catch (err) {
    // Non-blocking
  }
}
