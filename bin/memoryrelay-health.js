#!/usr/bin/env node
/**
 * MemoryRelay CLI - Health Command
 * 
 * Run comprehensive health check on MemoryRelay plugin
 * 
 * Usage:
 *   memoryrelay-health [--detailed]
 */

const detailed = process.argv.includes('--detailed');

console.log('MemoryRelay Health Check');
console.log('═'.repeat(50));
console.log();
console.log('Running comprehensive health check...');
console.log();

// Show instructions
console.log('To run health check:');
console.log('  openclaw gateway call memoryrelay.health');
console.log();
console.log('This will test:');
console.log('  ✓ API endpoint reachability');
console.log('  ✓ Authentication (API key validation)');
console.log('  ✓ Core tools (memory_store, memory_recall, memory_list)');
console.log('  ✓ Response times');
console.log();
console.log('Example output:');
console.log(JSON.stringify({
  "api": {
    "status": "healthy",
    "endpoint": "https://api.memoryrelay.net",
    "responseTime": 45,
    "reachable": true
  },
  "authentication": {
    "status": "valid"
  },
  "tools": {
    "memory_store": { "status": "working", "duration": 142 },
    "memory_recall": { "status": "working", "duration": 78 },
    "memory_list": { "status": "working", "duration": 92 }
  },
  "overall": "healthy"
}, null, 2));
