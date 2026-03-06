#!/usr/bin/env node
/**
 * MemoryRelay CLI - Metrics Command
 * 
 * View performance metrics for MemoryRelay plugin
 * 
 * Usage:
 *   memoryrelay-metrics
 */

console.log('MemoryRelay Performance Metrics');
console.log('═'.repeat(50));
console.log();
console.log('Collecting performance metrics...');
console.log();

console.log('To view metrics:');
console.log('  openclaw gateway call memoryrelay.metrics');
console.log();
console.log('Requirements:');
console.log('  • Debug mode must be enabled in plugin config');
console.log('  • Plugin must have processed API calls');
console.log();
console.log('Example output:');
console.log();
console.log('API CALLS');
console.log('  Total:      1,247');
console.log('  Successful: 1,198 (96.1%)');
console.log('  Failed:     49 (3.9%)');
console.log('  Avg Time:   132ms');
console.log();
console.log('TOP TOOLS (by call count)');
console.log('  memory_store:    456 calls, 98.2% success, 139ms avg');
console.log('  memory_recall:   387 calls, 100% success, 78ms avg');
console.log('  project_context: 142 calls, 100% success, 156ms avg');
console.log();
console.log('Full metrics structure:');
console.log(JSON.stringify({
  "summary": {
    "total": 1247,
    "successful": 1198,
    "failed": 49,
    "successRate": 96.1,
    "avgDuration": 132
  },
  "toolMetrics": {
    "memory_store": {
      "calls": 456,
      "successes": 448,
      "failures": 8,
      "avgDuration": 139,
      "successRate": 98,
      "p95Duration": 289,
      "p99Duration": 456
    }
  }
}, null, 2));
