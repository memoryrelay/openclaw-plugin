#!/usr/bin/env node
/**
 * Pre-install cleanup for npm global upgrades.
 *
 * Problem: npm upgrades rename the existing package dir to a temp location
 * before extracting the new tarball.  Packages with native .node binaries
 * (better-sqlite3, @matrix-org/...) leave files that make rmdir fail with
 * ENOTEMPTY, aborting the entire install.
 *
 * Fix: When we detect an existing installation in the global node_modules dir,
 * remove it before npm tries the rename.  Fresh installs are unaffected because
 * the target dir won't exist yet.
 *
 * Only runs when npm_config_global === "true" (global install) to avoid
 * interfering with local dev installs.
 */

const fs   = require('fs');
const path = require('path');

// Only act on global installs
if (process.env.npm_config_global !== 'true') process.exit(0);

// The existing install is at the same path npm is about to rename away.
// npm sets npm_config_prefix (e.g. /usr or /usr/local).
const prefix    = process.env.npm_config_prefix || '/usr';
const targetDir = path.join(prefix, 'lib', 'node_modules', '@memoryrelay', 'plugin-memoryrelay-ai');

if (!fs.existsSync(targetDir)) process.exit(0);   // fresh install — nothing to do

try {
  // Read current version so we can log it
  let oldVersion = '?';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf8'));
    oldVersion = pkg.version || '?';
  } catch {}

  fs.rmSync(targetDir, { recursive: true, force: true });
  console.log(`✅ Removed existing v${oldVersion} install to allow clean upgrade`);
} catch (err) {
  // Non-fatal — if we can't remove, npm will fail with ENOTEMPTY as before
  console.warn('⚠️  Could not remove existing install dir:', err.message);
  console.warn('   If npm fails with ENOTEMPTY, run manually:');
  console.warn(`   sudo rm -rf ${targetDir}`);
}
