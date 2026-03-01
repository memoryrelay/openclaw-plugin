#!/bin/bash
# MemoryRelay Plugin v0.6.0 - Installation Script
# Usage: bash install-v0.6.0.sh

set -e

echo "🚀 MemoryRelay Plugin v0.6.0 - Upgrade Script"
echo "=============================================="
echo ""

# Check if plugin directory exists
PLUGIN_DIR="$HOME/.openclaw/extensions/plugin-memoryrelay-ai"
if [ ! -d "$PLUGIN_DIR" ]; then
  echo "❌ Plugin directory not found: $PLUGIN_DIR"
  echo "   Please install the plugin first: openclaw plugins install @memoryrelay/plugin-memoryrelay-ai"
  exit 1
fi

echo "✅ Found plugin directory: $PLUGIN_DIR"
echo ""

# Backup current version
BACKUP_DIR="$PLUGIN_DIR.backup-$(date +%Y%m%d-%H%M%S)"
echo "📦 Creating backup: $BACKUP_DIR"
cp -r "$PLUGIN_DIR" "$BACKUP_DIR"
echo "✅ Backup created"
echo ""

# Copy new files
IMPROVEMENTS_DIR="$HOME/.openclaw/workspace/plugin-improvements"
if [ ! -d "$IMPROVEMENTS_DIR" ]; then
  echo "❌ Improvements directory not found: $IMPROVEMENTS_DIR"
  exit 1
fi

echo "📝 Upgrading plugin files..."
cp "$IMPROVEMENTS_DIR/index.ts" "$PLUGIN_DIR/"
cp "$IMPROVEMENTS_DIR/openclaw.plugin.json" "$PLUGIN_DIR/"
cp "$IMPROVEMENTS_DIR/package.json" "$PLUGIN_DIR/"
echo "✅ Core files upgraded"

# Optionally copy test suite
echo ""
read -p "Install test suite? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  cp "$IMPROVEMENTS_DIR/index.test.ts" "$PLUGIN_DIR/"
  echo "✅ Test suite installed"
  echo "   Run tests: cd $PLUGIN_DIR && npm test"
else
  echo "⏭️  Skipped test suite"
fi

echo ""
echo "=============================================="
echo "✅ Plugin upgraded to v0.6.0!"
echo ""
echo "📋 What's New:"
echo "  • Retry logic with exponential backoff (3 attempts)"
echo "  • Request timeout (30 seconds)"
echo "  • Environment variable support (MEMORYRELAY_API_KEY, etc.)"
echo "  • Channel filtering (excludeChannels config)"
echo "  • New CLI commands: stats, delete, export"
echo "  • 40+ test cases"
echo ""
echo "🔄 Next Steps:"
echo "  1. Review config (optional): vim ~/.openclaw/openclaw.json"
echo "  2. Restart gateway: openclaw gateway restart"
echo "  3. Verify upgrade: openclaw memoryrelay status"
echo "  4. Check logs: journalctl -u openclaw-gateway -f | grep memory-memoryrelay"
echo ""
echo "📚 Documentation: ~/workspace/plugin-improvements/CHANGELOG-v0.6.0.md"
echo ""
echo "💾 Backup location: $BACKUP_DIR"
echo "   To rollback: rm -rf $PLUGIN_DIR && mv $BACKUP_DIR $PLUGIN_DIR"
echo ""
echo "=============================================="
