#!/usr/bin/env node
/**
 * MemoryRelay CLI - Test Command
 * 
 * Test individual MemoryRelay tools
 * 
 * Usage:
 *   memoryrelay-test [--tool NAME]
 */

const args = process.argv.slice(2);
const tool = args.find(a => a.startsWith('--tool='))?.split('=')[1];

console.log('MemoryRelay Tool Test');
console.log('═'.repeat(50));
console.log();

if (!tool) {
  console.log('Usage: memoryrelay-test --tool=NAME');
  console.log();
  console.log('Available tools to test:');
  console.log('  • memory_store     - Store and delete a test memory');
  console.log('  • memory_recall    - Search for memories');
  console.log('  • memory_list      - List recent memories');
  console.log('  • project_list     - List projects');
  console.log('  • memory_health    - Check API health');
  console.log();
  console.log('Example:');
  console.log('  memoryrelay-test --tool=memory_store');
  process.exit(1);
}

console.log(`Testing tool: ${tool}`);
console.log();
console.log('To run test:');
console.log(`  openclaw gateway call memoryrelay.test '{"tool": "${tool}"}'`);
console.log();
console.log('Example output:');
console.log(JSON.stringify({
  "tool": tool,
  "duration": 142,
  "result": {
    "success": true,
    "message": "Test completed successfully"
  }
}, null, 2));
