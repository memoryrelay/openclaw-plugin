#!/usr/bin/env node
/**
 * MemoryRelay CLI - Logs Command
 * 
 * View debug logs from the MemoryRelay plugin
 * 
 * Usage:
 *   memoryrelay-logs [--limit N] [--tool NAME] [--errors-only]
 */

const args = process.argv.slice(2);
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '20');
const tool = args.find(a => a.startsWith('--tool='))?.split('=')[1];
const errorsOnly = args.includes('--errors-only');

console.log('MemoryRelay Debug Logs');
console.log('═'.repeat(50));
console.log();

if (tool) {
  console.log(`Tool: ${tool}`);
}
if (errorsOnly) {
  console.log('Filter: Errors only');
}
console.log(`Limit: ${limit}`);
console.log();

// In a real implementation, this would call the gateway method
// For now, show usage instructions
console.log('To use this command:');
console.log('1. Ensure debug mode is enabled in plugin config');
console.log('2. Run: openclaw gateway call memoryrelay.logs');
console.log();
console.log('Example config:');
console.log(JSON.stringify({
  "plugins": {
    "entries": {
      "plugin-memoryrelay-ai": {
        "config": {
          "debug": true,
          "verbose": false,
          "maxLogEntries": 100
        }
      }
    }
  }
}, null, 2));
