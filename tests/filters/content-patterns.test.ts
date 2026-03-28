// tests/filters/content-patterns.test.ts
import { describe, test, expect } from "vitest";
import { stripContent, resolveScope } from "../../src/filters/content-patterns.js";

describe("stripContent", () => {
  test("removes memoryrelay-workflow blocks", () => {
    const input = "Before <memoryrelay-workflow>instructions here</memoryrelay-workflow> After";
    expect(stripContent(input)).toBe("Before  After");
  });
  test("removes relevant-memories blocks", () => {
    const input = "Text <relevant-memories>\n- memory 1\n- memory 2\n</relevant-memories> more text";
    expect(stripContent(input)).toBe("Text  more text");
  });
  test("removes compaction-summary blocks", () => {
    const input = "Before <compaction-summary>removed 50 messages</compaction-summary> After";
    expect(stripContent(input)).toBe("Before  After");
  });
  test("removes system-reminder blocks", () => {
    const input = "Text <system-reminder>system info</system-reminder> more";
    expect(stripContent(input)).toBe("Text  more");
  });
  test("removes media/attachment references", () => {
    const input = "Look at [image: screenshot.png] for details";
    expect(stripContent(input)).toBe("Look at  for details");
  });
  test("removes large code blocks (> 500 chars)", () => {
    const code = "x".repeat(600);
    const input = `Before\n\`\`\`typescript\n${code}\n\`\`\`\nAfter`;
    const result = stripContent(input);
    expect(result).not.toContain(code);
    expect(result).toContain("Before");
    expect(result).toContain("After");
  });
  test("keeps small code blocks (< 500 chars)", () => {
    const input = "Before\n```typescript\nconst x = 1;\n```\nAfter";
    expect(stripContent(input)).toContain("const x = 1;");
  });
  test("collapses excessive whitespace", () => {
    const input = "Line 1\n\n\n\n\nLine 2";
    expect(stripContent(input)).toBe("Line 1\n\nLine 2");
  });
  test("returns content unchanged when nothing to strip", () => {
    const input = "This is a normal message with no special blocks.";
    expect(stripContent(input)).toBe(input);
  });
});

describe("resolveScope", () => {
  test("returns long-term for preference signals", () => {
    expect(resolveScope("I always prefer dark mode")).toBe("long-term");
    expect(resolveScope("I never use tabs")).toBe("long-term");
    expect(resolveScope("My name is Alice")).toBe("long-term");
  });
  test("returns long-term for remember/important signals", () => {
    expect(resolveScope("Remember that the API key rotates monthly")).toBe("long-term");
    expect(resolveScope("Important: the deploy requires manual approval")).toBe("long-term");
  });
  test("returns long-term for technical config signals", () => {
    expect(resolveScope("The API endpoint is https://api.example.com")).toBe("long-term");
    expect(resolveScope("Server config uses port 8080")).toBe("long-term");
  });
  test("returns long-term for decision signals", () => {
    expect(resolveScope("We decided to use PostgreSQL")).toBe("long-term");
    expect(resolveScope("The team approved the new architecture")).toBe("long-term");
  });
  test("returns long-term for pattern/convention signals", () => {
    expect(resolveScope("Our coding convention is to use camelCase")).toBe("long-term");
    expect(resolveScope("The standard is to run tests before merge")).toBe("long-term");
  });
  test("returns session for general conversation", () => {
    expect(resolveScope("Can you help me fix this bug?")).toBe("session");
    expect(resolveScope("The error is on line 42")).toBe("session");
    expect(resolveScope("Let me check the logs")).toBe("session");
  });
});
