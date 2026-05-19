/**
 * Comprehensive eval suite for pi-mdiff.
 *
 * Three layers:
 *
 *   1. Unit scenarios  — normalizeMarkdown + findInMarkdown correctness across
 *                        all markdown element types and reflow variants
 *
 *   2. Edit scenarios  — replaceBlock / insertBlockAfter / deleteBlock applied
 *                        to realistic document fixtures, verifying correctness
 *                        and blast radius (unintended sections unchanged)
 *
 *   3. Reflow matrix   — cross-product of (source format × search format) to
 *                        quantify what % of realistic LLM SEARCH failures are
 *                        recovered by normalization
 *
 * Run: npx tsx src/eval.ts
 * Outputs a pass/fail table + summary stats.
 */

import { normalizeMarkdown, findInMarkdown } from "./normalize.js";
import { replaceBlock, insertBlockAfter, deleteBlock, parseSections, describeSections } from "./ast.js";

// ── helpers ─────────────────────────────────────────────────────────────────

type Result = "pass" | "fail" | "xfail"; // xfail = known limitation, documented

interface EvalCase {
  id: string;
  category: string;
  description: string;
  run: () => Result | Promise<Result>;
}

const cases: EvalCase[] = [];
const stats = { pass: 0, fail: 0, xfail: 0 };

function test(id: string, category: string, description: string, fn: () => boolean | string): void {
  cases.push({
    id,
    category,
    description,
    run: () => {
      try {
        const result = fn();
        if (result === true || result === "pass") return "pass";
        if (result === "xfail") return "xfail";
        return "fail";
      } catch (e: any) {
        console.error(`    ERROR in ${id}: ${e.message}`);
        return "fail";
      }
    },
  });
}

function xtest(id: string, category: string, description: string, _fn: () => boolean): void {
  cases.push({ id, category, description, run: () => "xfail" });
}

// ── CATEGORY 1: Normalization correctness ──────────────────────────────────
//
// Verify that normalizeMarkdown correctly handles every markdown element type.
// Failures here mean the normalizer would corrupt documents or join things it
// shouldn't, producing false positives or false negatives in matching.

test("N01", "normalize", "Plain prose: 2-line soft wrap joined", () => {
  const src = "The quick brown fox\njumps over the lazy dog.";
  return normalizeMarkdown(src) === "The quick brown fox jumps over the lazy dog.";
});

test("N02", "normalize", "Plain prose: 3-line soft wrap fully joined", () => {
  const src = "Line one of a long paragraph that\nkeeps going on the second line\nand finishes on the third.";
  const norm = normalizeMarkdown(src);
  return norm === "Line one of a long paragraph that keeps going on the second line and finishes on the third.";
});

test("N03", "normalize", "Blank line = paragraph boundary, never joined", () => {
  const src = "Para one.\n\nPara two.";
  return normalizeMarkdown(src) === src;
});

test("N04", "normalize", "ATX heading never joined to next line", () => {
  const src = "## My Heading\nProse content.";
  const norm = normalizeMarkdown(src);
  return norm.includes("## My Heading\n");
});

test("N05", "normalize", "ATX heading never joined to prev line", () => {
  const src = "Prose content.\n## My Heading";
  const norm = normalizeMarkdown(src);
  return norm.includes("Prose content.\n## My Heading");
});

test("N06", "normalize", "Unordered list items not joined", () => {
  const src = "- Item one\n- Item two\n- Item three";
  return normalizeMarkdown(src) === src;
});

test("N07", "normalize", "Indented nested list items not joined", () => {
  const src = "- Parent\n  - Child one\n  - Child two\n- Sibling";
  return normalizeMarkdown(src) === src;
});

test("N08", "normalize", "Ordered list items not joined", () => {
  const src = "1. First\n2. Second\n3. Third";
  return normalizeMarkdown(src) === src;
});

test("N09", "normalize", "Blockquote lines not joined across >", () => {
  const src = "> Line one of quote.\n> Line two of quote.";
  return normalizeMarkdown(src) === src;
});

test("N10", "normalize", "Fenced code block contents never touched", () => {
  const src = "```python\nif x:\n    return y\n```";
  return normalizeMarkdown(src) === src;
});

test("N11", "normalize", "Prose before and after fence both normalized", () => {
  const src = "Before\nthe fence.\n\n```\ncode\n```\n\nAfter\nthe fence.";
  const norm = normalizeMarkdown(src);
  return (
    norm.includes("Before the fence.") &&
    norm.includes("After the fence.") &&
    norm.includes("```\ncode\n```")
  );
});

test("N12", "normalize", "Table rows not joined", () => {
  const src = "| Col A | Col B |\n|-------|-------|\n| val1  | val2  |";
  const norm = normalizeMarkdown(src);
  return (
    norm.includes("| Col A | Col B |") &&
    norm.includes("|-------|-------|") &&
    norm.includes("| val1  | val2  |") &&
    !norm.includes("| Col A | Col B | |")
  );
});

test("N13", "normalize", "YAML frontmatter never touched", () => {
  const src = "---\ntitle: My Doc\nauthor: Alice\ndate: 2025-01-01\n---\n\n## Section\n\nContent.\n";
  const norm = normalizeMarkdown(src);
  return (
    norm.includes("title: My Doc\n") &&
    norm.includes("author: Alice\n") &&
    !norm.includes("title: My Doc author:")
  );
});

test("N14", "normalize", "Horizontal rule not joined", () => {
  const src = "Above.\n\n---\n\nBelow.";
  return normalizeMarkdown(src) === src;
});

test("N15", "normalize", "Two-space trailing line break preserved", () => {
  const src = "Line with explicit break.  \nNext line separate.";
  const norm = normalizeMarkdown(src);
  // Should NOT be joined because of the two trailing spaces
  return norm.includes("Line with explicit break.  \nNext line separate.");
});

test("N16", "normalize", "List bullet normalization: * → -", () => {
  const src = "* Item one\n* Item two";
  return normalizeMarkdown(src) === "- Item one\n- Item two";
});

test("N17", "normalize", "List bullet normalization: + → -", () => {
  const src = "+ Item one\n+ Item two";
  return normalizeMarkdown(src) === "- Item one\n- Item two";
});

test("N18", "normalize", "3+ blank lines collapsed to 2", () => {
  const src = "Para one.\n\n\n\nPara two.";
  return normalizeMarkdown(src) === "Para one.\n\nPara two.";
});

test("N19", "normalize", "Mixed: prose + heading + list + fence all correct", () => {
  const src = [
    "Intro paragraph that",
    "wraps here.",
    "",
    "## Section",
    "",
    "- list item",
    "",
    "```ts",
    "const x = 1",
    "```",
    "",
    "Outro paragraph.",
  ].join("\n");
  const norm = normalizeMarkdown(src);
  return (
    norm.includes("Intro paragraph that wraps here.") &&
    norm.includes("## Section") &&
    norm.includes("- list item") &&
    norm.includes("const x = 1") &&
    norm.includes("Outro paragraph.")
  );
});

test("N20", "normalize", "Unicode content preserved correctly", () => {
  const src = "Привет мир,\nкак дела?";
  const norm = normalizeMarkdown(src);
  return norm === "Привет мир, как дела?";
});

// ── CATEGORY 2: findInMarkdown reflow recovery ─────────────────────────────
//
// These test the core value proposition: a SEARCH block that doesn't exactly
// match the file (because of line-wrapping differences) is still found.
// Each test represents a realistic LLM failure scenario.

test("F01", "find", "Exact match still works (no regression)", () => {
  const file = "## Section\n\nExact content here.\n";
  const match = findInMarkdown(file, "Exact content here.");
  return match !== null && match.normalized === false;
});

test("F02", "find", "2-line paragraph: LLM has joined, file is wrapped", () => {
  const file = "We use PostgreSQL\nfor all storage.\n";
  const search = "We use PostgreSQL for all storage.";
  return findInMarkdown(file, search) !== null;
});

test("F03", "find", "3-line paragraph: LLM has joined, file is wrapped", () => {
  const file = "Line one of the paragraph.\nLine two continues here.\nLine three ends it.\n";
  const search = "Line one of the paragraph. Line two continues here. Line three ends it.";
  return findInMarkdown(file, search) !== null;
});

test("F04", "find", "LLM has wrapped, file is joined (reverse reflow)", () => {
  const file = "Line one of the paragraph. Line two continues here. Line three ends it.\n";
  const search = "Line one of the paragraph.\nLine two continues here.\nLine three ends it.";
  return findInMarkdown(file, search) !== null;
});

test("F05", "find", "flowmark-style (sentence-per-line) vs 80-char-wrapped", () => {
  // flowmark: one sentence per line
  const file = "The system uses PostgreSQL.\nThe schema is in schema.sql.\nMigrations use Alembic.\n";
  // LLM saw 80-char-wrapped version
  const search = "The system uses PostgreSQL. The schema is in schema.sql. Migrations use Alembic.";
  return findInMarkdown(file, search) !== null;
});

test("F06", "find", "SEARCH includes heading context + paragraph", () => {
  const file = "## Database\n\nWe use PostgreSQL\nfor all storage.\n";
  const search = "## Database\n\nWe use PostgreSQL for all storage.";
  return findInMarkdown(file, search) !== null;
});

test("F07", "find", "Multi-paragraph SEARCH across a blank line", () => {
  const file = "First paragraph\nspanning lines.\n\nSecond paragraph\nalso wrapped.\n";
  const search = "First paragraph spanning lines.\n\nSecond paragraph also wrapped.";
  return findInMarkdown(file, search) !== null;
});

test("F08", "find", "No match returns null (hallucinated content)", () => {
  const file = "We use PostgreSQL for all storage.\n";
  const search = "We use MongoDB for all storage.";
  return findInMarkdown(file, search) === null;
});

test("F09", "find", "Recovered match splice produces correct result", () => {
  const file = "Before.\nThe target sentence\nspanning two lines.\nAfter.\n";
  const search = "The target sentence spanning two lines.";
  const match = findInMarkdown(file, search);
  if (!match) return false;
  const result = file.slice(0, match.start) + "REPLACED" + file.slice(match.end);
  return result === "Before.\nREPLACED\nAfter.\n";
});

test("F10", "find", "Table content not falsely matched as prose", () => {
  // A search for joined table row content should not match table row
  const file = "| Name | Value |\n|------|-------|\n| foo  | bar   |\n";
  const search = "Name Value foo bar"; // garbage join of table content
  return findInMarkdown(file, search) === null;
});

// ── CATEGORY 3: md_edit correctness ─────────────────────────────────────────
//
// End-to-end edit operations on realistic document fixtures.
// Each test verifies: (a) the target was changed, (b) blast radius = zero.

const ARCH_DOC = `---
title: Architecture Guide
---

# System Architecture

Introductory paragraph about the system.

## Database Layer

We use SQLite for local development.
The schema is defined in schema.sql.
All queries go through the repository layer.

## API Layer

The REST API is built with Express.
Authentication is handled by JWT middleware.

## Frontend

The UI is built with React.
State management uses Redux.

## Deployment

We deploy to AWS EC2.
The CI/CD pipeline runs on GitHub Actions.
`;

test("E01", "md_edit", "replace: correct block replaced", () => {
  const result = replaceBlock(ARCH_DOC, "Database Layer", 0, "We use PostgreSQL.");
  return result.includes("We use PostgreSQL.") && !result.includes("We use SQLite");
});

test("E02", "md_edit", "replace: other sections untouched (blast radius = 0)", () => {
  const result = replaceBlock(ARCH_DOC, "Database Layer", 0, "We use PostgreSQL.");
  return (
    result.includes("The REST API is built with Express.") &&
    result.includes("The UI is built with React.") &&
    result.includes("We deploy to AWS EC2.")
  );
});

test("E03", "md_edit", "replace: frontmatter preserved", () => {
  const result = replaceBlock(ARCH_DOC, "Database Layer", 0, "We use PostgreSQL.");
  return result.startsWith("---\ntitle: Architecture Guide\n---");
});

test("E04", "md_edit", "replace: heading structure intact", () => {
  const result = replaceBlock(ARCH_DOC, "Database Layer", 0, "We use PostgreSQL.");
  return (
    result.includes("## Database Layer") &&
    result.includes("## API Layer") &&
    result.includes("## Frontend") &&
    result.includes("## Deployment")
  );
});

test("E05", "md_edit", "insert_after: new block appears after target", () => {
  const result = insertBlockAfter(ARCH_DOC, "Database Layer", 0, "Added paragraph here.");
  const dbIdx = result.indexOf("We use SQLite");
  const addIdx = result.indexOf("Added paragraph here.");
  return addIdx > dbIdx;
});

test("E06", "md_edit", "insert_after: original block preserved", () => {
  const result = insertBlockAfter(ARCH_DOC, "Database Layer", 0, "Added paragraph here.");
  return result.includes("We use SQLite for local development.");
});

test("E07", "md_edit", "delete: target block removed", () => {
  const result = deleteBlock(ARCH_DOC, "Database Layer", 0);
  return !result.includes("We use SQLite");
});

test("E08", "md_edit", "delete: section heading preserved after delete", () => {
  const result = deleteBlock(ARCH_DOC, "Database Layer", 0);
  return result.includes("## Database Layer");
});

test("E09", "md_edit", "delete: adjacent sections untouched", () => {
  const result = deleteBlock(ARCH_DOC, "Database Layer", 0);
  return (
    result.includes("The REST API is built with Express.") &&
    result.includes("## API Layer")
  );
});

test("E10", "md_edit", "case-insensitive section lookup works", () => {
  const result = replaceBlock(ARCH_DOC, "database layer", 0, "New content.");
  return result.includes("New content.") && !result.includes("We use SQLite");
});

test("E11", "md_edit", "lookup with ## prefix works", () => {
  const result = replaceBlock(ARCH_DOC, "## Database Layer", 0, "New content.");
  return result.includes("New content.");
});

test("E12", "md_edit", "error: nonexistent section throws", () => {
  try {
    replaceBlock(ARCH_DOC, "Nonexistent Section", 0, "x");
    return false;
  } catch (e: any) {
    return e.message.includes("not found");
  }
});

test("E13", "md_edit", "error: block index out of range throws", () => {
  try {
    replaceBlock(ARCH_DOC, "Database Layer", 99, "x");
    return false;
  } catch (e: any) {
    return e.message.includes("not found");
  }
});

test("E14", "md_edit", "replace multiblock section: target block 1 correct", () => {
  // Add a second block to Database Layer
  const doc = ARCH_DOC.replace(
    "All queries go through the repository layer.",
    "All queries go through the repository layer.\n\nThis is block index 1."
  );
  const result = replaceBlock(doc, "Database Layer", 1, "Block 1 replaced.");
  return result.includes("Block 1 replaced.") && result.includes("We use SQLite");
});

test("E15", "md_edit", "describeSections output usable for navigation", () => {
  const desc = describeSections(ARCH_DOC);
  return (
    desc.includes("Database Layer") &&
    desc.includes("[0]") &&
    desc.includes("paragraph")
  );
});

// ── CATEGORY 4: Reflow matrix ─────────────────────────────────────────────
//
// Cross-product: source format × search format.
// Quantifies what % of realistic format-mismatch failures are recovered.
//
// Source formats: (A) flowmark sentence-per-line, (B) 80-char hard-wrap,
//                 (C) single long line, (D) mixed indent
// Search formats: same 4 formats applied to the same semantic content.
// Only A×A, B×B, C×C, D×D are "exact" — all others are reflow mismatches.

const PARA = {
  // All four represent the same semantic paragraph
  A: "The system uses PostgreSQL for storage.\nThe schema is managed by Alembic.\nAll access goes through the repository layer.",
  B: "The system uses PostgreSQL for storage. The schema is\nmanaged by Alembic. All access goes through the\nrepository layer.",
  C: "The system uses PostgreSQL for storage. The schema is managed by Alembic. All access goes through the repository layer.",
  D: "The system uses PostgreSQL for storage.\n  The schema is managed by Alembic.\n  All access goes through the repository layer.",
};

const formats = ["A", "B", "C"] as const; // D excluded: indented prose is unusual

for (const srcFmt of formats) {
  for (const searchFmt of formats) {
    const id = `R${srcFmt}${searchFmt}`;
    const exact = srcFmt === searchFmt;
    test(
      id,
      "reflow",
      `${exact ? "exact" : "reflow"}: source=${srcFmt} search=${searchFmt}`,
      () => {
        const file = `## Section\n\n${PARA[srcFmt]}\n`;
        const match = findInMarkdown(file, PARA[searchFmt]);
        return match !== null;
      }
    );
  }
}

// ── CATEGORY 5: Edge cases ────────────────────────────────────────────────

test("X01", "edge", "Empty file: no crash", () => {
  normalizeMarkdown("");
  return true;
});

test("X02", "edge", "File with only frontmatter: no crash", () => {
  normalizeMarkdown("---\ntitle: Empty\n---\n");
  return true;
});

test("X03", "edge", "File with only a heading: no crash", () => {
  const sections = parseSections("## Only Heading\n");
  return Array.isArray(sections);
});

test("X04", "edge", "Preamble content before first heading found", () => {
  const doc = "Preamble content here.\n\n## Section\n\nBody.\n";
  const sections = parseSections(doc);
  const pre = sections.find((s) => s.headingText === "(preamble)");
  return pre !== undefined && pre.blocks.length > 0;
});

test("X05", "edge", "Duplicate section headings: both found", () => {
  const doc = "## API\n\nFirst.\n\n## API\n\nSecond.\n";
  const sections = parseSections(doc);
  return sections.filter((s) => s.headingText === "API").length === 2;
});

test("X06", "edge", "Very long paragraph (500 words): no crash or truncation", () => {
  const words = Array.from({ length: 500 }, (_, i) => `word${i}`);
  const longPara = words.join(" ");
  const norm = normalizeMarkdown(longPara);
  return norm === longPara; // already single line, no change
});

test("X07", "edge", "Inline code not treated as fence", () => {
  const src = "Use `const x = 1` for constants\nand `let y = 2` for variables.";
  const norm = normalizeMarkdown(src);
  return norm === "Use `const x = 1` for constants and `let y = 2` for variables.";
});

test("X08", "edge", "Link with parentheses not corrupted", () => {
  const src = "See [the docs](https://example.com/path)\nfor more information.";
  const norm = normalizeMarkdown(src);
  return norm.includes("https://example.com/path") && !norm.includes("\n");
});

test("X09", "edge", "setext heading (===) detected as structural", () => {
  const doc = "Title\n=====\n\nContent here.\n";
  const norm = normalizeMarkdown(doc);
  // === should not be joined into "Title ====="
  return norm.includes("Title\n=====");
});

test("X10", "edge", "HTML comment block not joined with adjacent prose", () => {
  const src = "<!-- comment -->\nProse after comment.";
  const norm = normalizeMarkdown(src);
  return norm.includes("<!-- comment -->\n");
});

// ── Run ─────────────────────────────────────────────────────────────────────

const CATEGORY_ORDER = ["normalize", "find", "md_edit", "reflow", "edge"];
const WIDTH = { id: 6, cat: 12, result: 7 };

console.log("\n" + "═".repeat(72));
console.log("  pi-mdiff eval");
console.log("═".repeat(72));

let currentCat = "";
for (const c of cases) {
  const result = await c.run();
  stats[result]++;

  if (c.category !== currentCat) {
    currentCat = c.category;
    console.log(`\n  ── ${c.category.toUpperCase()} ──`);
  }

  const icon = result === "pass" ? "✓" : result === "xfail" ? "○" : "✗";
  const label = result === "pass" ? "PASS" : result === "xfail" ? "SKIP" : "FAIL";
  console.log(`  ${icon} [${c.id}] ${c.description}`);
  if (result === "fail") {
    console.log(`       └─ ${label}`);
  }
}

const total = stats.pass + stats.fail + stats.xfail;
const pct = Math.round((stats.pass / (total - stats.xfail)) * 100);

console.log("\n" + "═".repeat(72));
console.log(`  Results: ${stats.pass} passed, ${stats.fail} failed, ${stats.xfail} skipped`);
console.log(`  Pass rate: ${pct}% (${stats.pass}/${total - stats.xfail})`);

// Category breakdown
const byCategory: Record<string, { pass: number; fail: number; total: number }> = {};
for (const c of cases) {
  if (!byCategory[c.category]) byCategory[c.category] = { pass: 0, fail: 0, total: 0 };
  const r = await c.run();
  if (r !== "xfail") {
    byCategory[c.category].total++;
    if (r === "pass") byCategory[c.category].pass++;
    else byCategory[c.category].fail++;
  }
}

console.log("\n  By category:");
for (const cat of CATEGORY_ORDER) {
  const s = byCategory[cat];
  if (!s) continue;
  const catPct = Math.round((s.pass / s.total) * 100);
  const bar = "█".repeat(Math.round(catPct / 5)) + "░".repeat(20 - Math.round(catPct / 5));
  console.log(`  ${cat.padEnd(12)} ${bar} ${catPct}% (${s.pass}/${s.total})`);
}

console.log("═".repeat(72) + "\n");

if (stats.fail > 0) process.exit(1);
