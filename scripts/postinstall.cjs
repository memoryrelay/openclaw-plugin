#!/usr/bin/env node
/**
 * Post-install verification script.
 * 1. Verifies better-sqlite3 native binary is properly compiled.
 * 2. Auto-configures plugins.allow in ~/.openclaw/openclaw.json (#105).
 */

// --- 1. Verify better-sqlite3 ---
try {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.prepare('SELECT 1').get();
  db.close();
  console.log('✅ better-sqlite3 native binary OK');
} catch (err) {
  console.warn('⚠️  better-sqlite3 native binary not available.');
  console.warn('   Local cache will be disabled (API-only mode).');
  console.warn('   To enable local caching, run: npm rebuild better-sqlite3');
  console.warn('   Error:', err.message);
  // Do NOT exit with non-zero — plugin still works in API-only mode
}

// --- 2. Auto-configure plugins.allow (#105) ---
const path = require('path');
const fs = require('fs');
const os = require('os');

const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');

try {
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);

    if (!config.plugins) config.plugins = {};
    const allow = config.plugins.allow || [];

    if (!allow.includes('plugin-memoryrelay-ai')) {
      allow.push('plugin-memoryrelay-ai');
      config.plugins.allow = allow;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      console.log('✅ Added plugin-memoryrelay-ai to plugins.allow in OpenClaw config');
    } else {
      console.log('✅ plugin-memoryrelay-ai already in plugins.allow');
    }
  }
} catch (err) {
  // Non-blocking — config update is best-effort
  console.warn('⚠️  Could not auto-update plugins.allow:', err.message);
  console.warn('   Manually add "plugin-memoryrelay-ai" to plugins.allow in ~/.openclaw/openclaw.json');
}
