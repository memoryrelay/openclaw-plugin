/**
 * First-Run Onboarding Wizard (Phase 1 - Issue #9)
 * 
 * Detects first run and guides user through initial setup
 * Stores first memory, configures auto-capture preferences
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

export interface OnboardingState {
  completed: boolean;
  completedAt?: number;
  firstMemoryId?: string;
  autoCaptureOptIn?: boolean;
}

export interface OnboardingResult {
  isFirstRun: boolean;
  shouldOnboard: boolean;
  state?: OnboardingState;
}

/**
 * Get onboarding state file path
 */
function getStateFilePath(): string {
  const homeDir = os.homedir();
  const openclawDir = path.join(homeDir, ".openclaw");
  return path.join(openclawDir, "memoryrelay-onboarding.json");
}

/**
 * Check if this is the first run
 */
export async function checkFirstRun(
  getTotalMemories: () => Promise<number>
): Promise<OnboardingResult> {
  const stateFile = getStateFilePath();
  
  try {
    // Check if state file exists
    const stateContent = await fs.readFile(stateFile, "utf-8");
    const state: OnboardingState = JSON.parse(stateContent);
    
    // Already onboarded
    if (state.completed) {
      return {
        isFirstRun: false,
        shouldOnboard: false,
        state,
      };
    }
  } catch (err) {
    // State file doesn't exist - might be first run
  }

  // Check if there are any memories
  const totalMemories = await getTotalMemories();
  
  // First run if: no state file AND no memories
  const isFirstRun = totalMemories === 0;
  
  return {
    isFirstRun,
    shouldOnboard: isFirstRun,
  };
}

/**
 * Mark onboarding as complete
 */
export async function markOnboardingComplete(
  firstMemoryId: string,
  autoCaptureOptIn: boolean
): Promise<void> {
  const stateFile = getStateFilePath();
  const state: OnboardingState = {
    completed: true,
    completedAt: Date.now(),
    firstMemoryId,
    autoCaptureOptIn,
  };

  // Ensure directory exists
  const dir = path.dirname(stateFile);
  await fs.mkdir(dir, { recursive: true });

  // Write state file
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Generate onboarding prompt text
 */
export function generateOnboardingPrompt(): string {
  const lines: string[] = [];
  
  lines.push("👋 Welcome to MemoryRelay!");
  lines.push("");
  lines.push("This is your first time using MemoryRelay. Let's get you set up!");
  lines.push("");
  lines.push("MemoryRelay helps you remember important information across conversations.");
  lines.push("It uses semantic search to recall relevant context when you need it.");
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("🎯 QUICK START");
  lines.push("");
  lines.push("1. Store your first memory (try: 'I prefer concise responses')");
  lines.push("2. Later, I'll automatically recall it when relevant");
  lines.push("3. Your memories grow smarter over time");
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("⚙️  SMART AUTO-CAPTURE");
  lines.push("");
  lines.push("MemoryRelay can automatically detect and store important information:");
  lines.push("");
  lines.push("  ✅ Credentials (API keys, connection strings)");
  lines.push("  ✅ Preferences (communication style, tool choices)");
  lines.push("  ✅ Technical facts (commands, configs, troubleshooting)");
  lines.push("  ❌ Personal info (requires your confirmation first)");
  lines.push("");
  lines.push("Your first 5 auto-captures will ask for confirmation to ensure");
  lines.push("you're comfortable with what's being stored. After that, it runs");
  lines.push("silently in the background.");
  lines.push("");
  lines.push("Would you like to enable smart auto-capture? (Recommended)");
  lines.push("");
  lines.push("Type 'yes' to enable, or 'no' to manually store memories");
  lines.push("");
  
  return lines.join("\n");
}

/**
 * Generate success message after onboarding
 */
export function generateSuccessMessage(
  firstMemoryContent: string,
  autoCaptureEnabled: boolean
): string {
  const lines: string[] = [];
  
  lines.push("✅ Onboarding Complete!");
  lines.push("");
  lines.push(`Your first memory has been stored:`);
  lines.push(`"${firstMemoryContent}"`);
  lines.push("");
  
  if (autoCaptureEnabled) {
    lines.push("🎯 Smart auto-capture is enabled");
    lines.push("   I'll detect and store important information automatically");
    lines.push("   (Your first 5 captures will ask for confirmation)");
  } else {
    lines.push("📝 Manual mode selected");
    lines.push("   Use memory_store tool to save memories manually");
    lines.push("   You can enable auto-capture anytime in config");
  }
  
  lines.push("");
  lines.push("💡 Quick tips:");
  lines.push("  • Store preferences, facts, commands, and insights");
  lines.push("  • I'll automatically recall relevant memories in future conversations");
  lines.push("  • Check stats anytime with: openclaw gateway-call memoryrelay.stats");
  lines.push("  • Morning/evening summaries show your memory growth");
  lines.push("");
  lines.push("Ready to remember everything! 🚀");
  lines.push("");
  
  return lines.join("\n");
}

/**
 * Interactive onboarding flow (for CLI or chat)
 */
export async function runOnboardingFlow(
  storeMemory: (content: string, metadata?: Record<string, string>) => Promise<{ id: string }>,
  getUserResponse: (prompt: string) => Promise<string>
): Promise<{
  completed: boolean;
  firstMemoryId?: string;
  autoCaptureEnabled?: boolean;
}> {
  // Show welcome
  const welcomePrompt = generateOnboardingPrompt();
  const autoCaptureResponse = await getUserResponse(welcomePrompt);
  
  // Parse auto-capture preference
  const autoCaptureEnabled = autoCaptureResponse.toLowerCase().includes("yes");
  
  // Prompt for first memory
  const firstMemoryPrompt = [
    "",
    "Great! Let's store your first memory.",
    "",
    "What would you like me to remember?",
    "(Examples: 'I prefer Python', 'My project uses PostgreSQL', 'I'm building a chatbot')",
    "",
  ].join("\n");
  
  const firstMemoryContent = await getUserResponse(firstMemoryPrompt);
  
  // Store first memory
  const result = await storeMemory(firstMemoryContent, {
    category: "onboarding",
    source: "first-run-wizard",
  });
  
  // Mark complete
  await markOnboardingComplete(result.id, autoCaptureEnabled);
  
  return {
    completed: true,
    firstMemoryId: result.id,
    autoCaptureEnabled,
  };
}

/**
 * Simple non-interactive onboarding (for automatic setup)
 */
export async function runSimpleOnboarding(
  storeMemory: (content: string, metadata?: Record<string, string>) => Promise<{ id: string }>,
  defaultMemory: string = "MemoryRelay onboarding complete",
  autoCaptureEnabled: boolean = true
): Promise<void> {
  const result = await storeMemory(defaultMemory, {
    category: "system",
    source: "auto-onboarding",
  });
  
  await markOnboardingComplete(result.id, autoCaptureEnabled);
}
