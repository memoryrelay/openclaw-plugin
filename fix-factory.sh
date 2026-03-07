#!/bin/bash

# Backup
cp index.ts index.ts.before-factory

# Step 1: Find and replace the tool registration pattern
# We need to convert: api.registerTool({ ... }, { name: "tool_name" })
# To: api.registerTool((ctx) => ({ ... }), { name: "tool_name" })

# This is complex, so let's do it in Python for better control
python3 << 'PYTHON_EOF'
import re

with open('index.ts', 'r') as f:
    content = f.read()

# Find the tools section
tools_start = content.find('  // 1. memory_store')
tools_end = content.find('  // ==========================================================================\n  // CLI Commands')

if tools_start == -1 or tools_end == -1:
    print("Could not find tools section boundaries")
    exit(1)

before_tools = content[:tools_start]
tools_section = content[tools_start:tools_end]
after_tools = content[tools_end:]

# Pattern to match tool registration
# api.registerTool(\n      {  ... },\n      { name: "..." },\n    );
pattern = r'api\.registerTool\(\n      \{'

# Replace with factory pattern
replacement = 'api.registerTool((ctx) => ({'

tools_section = tools_section.replace(pattern, replacement)

# Now fix the closing: change },\n      { name: to }),\n      { name:
tools_section = re.sub(
    r'\},\n      \{ name:',
    '}),\n      { name:',
    tools_section
)

# Remove context parameter from execute functions
# execute: async (\n          _id,\n          args: { ... },\n          context?: { ... },\n        ) =>
tools_section = re.sub(
    r'(execute: async \(\n\s+_id,\n\s+args: \{[^}]+\},)\n\s+context\?: \{[^}]+\},\n',
    r'\1\n',
    tools_section,
    flags=re.MULTILINE
)

# Replace context?.sessionId with ctx.sessionId
tools_section = tools_section.replace('context?.sessionId', 'ctx.sessionId')

# Combine
new_content = before_tools + tools_section + after_tools

with open('index.ts', 'w') as f:
    f.write(new_content)

print("✅ Converted to factory pattern")
PYTHON_EOF

