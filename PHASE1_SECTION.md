# Phase 1 Section for README

## Phase 1: Zero-Friction Adoption Framework (v0.12.0+)

Phase 1 introduces features designed to make MemoryRelay "just work" without manual effort. The goal: store 3-5x more memories with zero additional work.

### Smart Auto-Capture (Issue #12)

**Tier-Based Privacy System** — Four capture modes with built-in privacy protection:

| Tier | When to Use | Privacy Level |
|------|-------------|---------------|
| `off` | Manual storage only | N/A |
| `conservative` | Low-risk conversations only | High (blocks most patterns) |
| `smart` | **Default** — Balanced automation | Medium (blocks sensitive data) |
| `aggressive` | Maximum capture | Low (minimal blocking) |

**Privacy Blocklist** — Automatically filters:
- Passwords and API keys (`password: xxx`, `api_key=xxx`)
- Credit card numbers (Visa, MC, Amex, Discover patterns)
- Social Security Numbers (`SSN: xxx-xx-xxxx`)
- Email addresses and phone numbers (when tier < aggressive)

**Configuration**:

```json
{
  "autoCapture": {
    "enabled": true,
    "tier": "smart",
    "confirmFirst": 5
  }
}
```

**Backward Compatibility**: Boolean values still work (`true` → `{enabled: true, tier: "smart"}`)

**First-5 Confirmations** — On `smart`/`aggressive` tiers, first 5 captures show confirmation prompts. After 5, auto-capture runs silently. Reset by setting `confirmFirst: 5` again.

---

### Daily Memory Stats (Issue #10)

**Morning Check** (9:00 AM) — Start your day with memory growth stats:
```
📊 Memory Stats (Morning Check)
Total: 1,247 memories | Today: 8 (+3 since yesterday)
This week: 52 memories (+15% vs last week)
Top categories: development (18), decisions (12), patterns (7)
```

**Evening Review** (8:00 PM) — End your day with activity summary:
```
🌙 Memory Activity (Evening Review)  
Today: 12 memories stored | Most recalled: "NorthRelay API v9.0 architecture"
Most valuable: [Memory about critical bug fix in authentication flow]
```

**Gateway Method**: `memoryrelay:heartbeat`

**Configuration**:
```json
{
  "dailyStats": {
    "enabled": true,
    "morningTime": "09:00",
    "eveningTime": "20:00"
  }
}
```

**Integration with HEARTBEAT.md** — Add to your workspace `HEARTBEAT.md`:
```markdown
## MemoryRelay Health
Every heartbeat, check memory stats:
- Run morning check at 9 AM
- Run evening review at 8 PM
- Report if memory storage rate drops below 5/week
```

---

### CLI Stats Command (Issue #11)

**Comprehensive Statistics** — View memory metrics anytime:

```bash
openclaw gateway-call memoryrelay.stats
```

**Text Output**:
```
MemoryRelay Statistics
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Storage
  Total: 1,247 memories
  Today: 8 memories
  This week: 52 memories (+15% vs last week)
  This month: 218 memories (+8% vs last month)

Top 10 Categories
  development ........................ 342 (27%)
  decisions .......................... 156 (12%)
  patterns ........................... 128 (10%)
  infrastructure ..................... 94 (8%)
  [...]

Recent Memories (last 5)
  [2026-03-06 12:35] Phase 1 validation test
  [2026-03-06 10:25] Phase 1 implementation complete
  [2026-03-06 09:11] Issue #8 broken down
  [...]
```

**JSON Output** (for scripts):
```bash
openclaw gateway-call memoryrelay.stats '{"format": "json"}'
```

**Verbose Mode** (includes growth charts, recall stats):
```bash
openclaw gateway-call memoryrelay.stats '{"verbose": true}'
```

---

### First-Run Onboarding (Issue #9)

**Automatic Welcome** — On fresh install (no memories + no onboarding state):

1. Plugin detects first run
2. Creates welcome memory: "Welcome to MemoryRelay! This is your first memory."
3. Shows auto-capture explanation
4. Saves state to `~/.openclaw/memoryrelay-onboarding.json`
5. Never repeats (state file persists)

**Manual Trigger** (show again or for new users):
```bash
openclaw gateway-call memoryrelay.onboarding
```

**What Users See**:
```
🎉 Welcome to MemoryRelay!

I just stored my first memory: "Welcome to MemoryRelay! This is your first memory."

Auto-capture is enabled (tier: smart). I'll automatically remember:
✓ Important decisions and changes
✓ Technical discoveries and solutions  
✓ Project context and conventions

Privacy protected — I filter out:
✗ Passwords and API keys
✗ Credit card numbers
✗ Social Security Numbers
✗ Personal secrets

You're all set! I'll build memory over time as we work together.
```

---

### Gateway Methods Summary

| Method | Purpose | Example |
|--------|---------|---------|
| `memoryrelay:heartbeat` | Daily stats check (morning/evening) | `openclaw gateway-call memoryrelay.heartbeat` |
| `memoryrelay:stats` | CLI stats command | `openclaw gateway-call memoryrelay.stats '{"format": "json"}'` |
| `memoryrelay:onboarding` | Show/restart onboarding | `openclaw gateway-call memoryrelay.onboarding` |

**Note**: These are gateway methods, not shell commands. Invoke via `openclaw gateway-call memoryrelay.<method>`.

---

### Expected Impact

Based on Zero-Friction Adoption Strategy (Issue #8):

| Metric | Before | After Phase 1 | Target |
|--------|--------|---------------|--------|
| Memory storage rate | 5/week | 15-25/week | 3-5x |
| Daily active usage | 10% | 40-50% | 4-5x |
| Auto-capture adoption | 0% | 40-50% | 70% |
| First memory time | N/A | <2 min | <5 min |

---

