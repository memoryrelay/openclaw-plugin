## Installation

### Step 1: Install the plugin

```bash
openclaw plugins install @memoryrelay/plugin-memoryrelay-ai
```

### Step 2: Add configuration (REQUIRED)

⚠️ **Important**: OpenClaw does NOT preserve config during installation. You must add it manually after EVERY install/update:

```bash
cat ~/.openclaw/openclaw.json | jq '.plugins.entries."plugin-memoryrelay-ai".config = {
  "apiKey": "YOUR_API_KEY",
  "agentId": "YOUR_AGENT_ID"
}' > /tmp/config.json && \
mv /tmp/config.json ~/.openclaw/openclaw.json && \
chmod 600 ~/.openclaw/openclaw.json
```

**Get your API key**: https://memoryrelay.ai

### Step 3: Restart

```bash
openclaw gateway restart
```

### Step 4: Verify

```bash
openclaw status | grep Memory
# Should show: Memory | enabled (plugin plugin-memoryrelay-ai) · available
```

---

## Configuration Reference

Add to `plugins.entries."plugin-memoryrelay-ai".config`:

```json
{
  "apiKey": "mem_prod_...",     // REQUIRED: Your API key
  "agentId": "iris",            // REQUIRED: Unique agent ID
  "apiUrl": "https://api.memoryrelay.net",  // Optional
  "autoRecall": true,           // Optional: Auto-inject memories
  "autoCapture": false,         // Optional: Auto-capture
  "recallLimit": 5,             // Optional: Max memories
  "recallThreshold": 0.3        // Optional: Min similarity
}
```

### Why Manual Config?

OpenClaw separates config from plugin code by design:
- `plugins install` only installs code
- Config lives in `openclaw.json`
- Must be added manually for security/flexibility
- This is intentional OpenClaw behavior

