/**
 * Tests for normalize.ts and ast.ts
 * Run with: node --experimental-vm-modules src/test.ts
 * (or via jiti which pi uses for extensions)
 */

import { normalizeMarkdown, findInMarkdown, normalizeProse, splitSegments } from "./normalize.js";
import { parseSections, findSection, describeSections, replaceBlock, insertBlockAfter, deleteBlock, appendToSection, renameSection, deleteSection, addSection } from "./ast.js";

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? `\n    ${detail}` : ""}`);
    failed++;
  }
}

function assertEqual(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    assert(label, false, `\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
  } else {
    assert(label, true);
  }
}

// ---------------------------------------------------------------------------
console.log("\n── splitSegments ──");
{
  const src = "prose\n\n```ts\nconst x = 1\n```\n\nmore prose";
  const segs = splitSegments(src);
  assertEqual("segment count", segs.length, 3);
  assertEqual("first is prose", segs[0].kind, "prose");
  assertEqual("second is fence", segs[1].kind, "fence");
  assertEqual("third is prose", segs[2].kind, "prose");
}

// ---------------------------------------------------------------------------
console.log("\n── normalizeProse ──");
{
  // Soft-wrapped paragraph should be joined
  const wrapped = "The quick brown fox\njumps over the lazy dog.";
  const norm = normalizeProse(wrapped);
  assertEqual("joins soft-wrapped lines", norm, "The quick brown fox jumps over the lazy dog.");

  // Heading after line must NOT be joined
  const withHeading = "Some prose\n## Heading\nMore prose";
  const normH = normalizeProse(withHeading);
  assert("preserves heading boundary", normH.includes("prose\n## Heading\nMore prose"));

  // Blank line = paragraph boundary, must not be joined
  const paraBreak = "Para one.\n\nPara two.";
  assertEqual("preserves paragraph breaks", normalizeProse(paraBreak), paraBreak);

  // List items not joined
  const list = "- item one\n- item two";
  assertEqual("preserves list items", normalizeProse(list), list);
}

// ---------------------------------------------------------------------------
console.log("\n── normalizeMarkdown ──");
{
  // Fenced code block should be left alone
  const withFence = "Prose before.\n\n```ts\nconst x =\n  1\n```\n\nProse after.";
  const norm = normalizeMarkdown(withFence);
  assert("preserves fence content", norm.includes("const x =\n  1"));
  assert("normalizes prose around fence", !norm.includes("Prose before.\n```"));
}

// ---------------------------------------------------------------------------
console.log("\n── findInMarkdown ──");
{
  const file =
    "# Title\n\nThe quick brown fox\njumps over the lazy dog.\n\n## Section\n\nAnother paragraph here.";

  // Exact match should work
  const exact = findInMarkdown(file, "## Section\n\nAnother paragraph here.");
  assert("exact match found", exact !== null);
  assert("exact match not normalized", exact?.normalized === false);

  // Normalized match — search with joined prose
  const normSearch = "The quick brown fox jumps over the lazy dog.";
  const normMatch = findInMarkdown(file, normSearch);
  assert("normalized match found", normMatch !== null);
  assert("normalized match flagged", normMatch?.normalized === true);

  // No match at all
  const noMatch = findInMarkdown(file, "text that does not exist anywhere");
  assert("no match returns null", noMatch === null);
}

// ---------------------------------------------------------------------------
console.log("\n── parseSections ──");
{
  const doc = `# Title

Intro paragraph.

## Architecture

First paragraph in arch.

Second paragraph in arch.

### Sub-section

Sub content here.

## Deployment

Deploy paragraph.
`;

  const sections = parseSections(doc);
  assert("sections parsed", sections.length >= 4);

  const arch = findSection(sections, "Architecture");
  assert("Architecture section found", arch !== null);
  assertEqual("Architecture has 2 blocks", arch?.blocks.length, 2);
  assert("first block text", arch?.blocks[0].text.includes("First paragraph") ?? false);
  assert("second block text", arch?.blocks[1].text.includes("Second paragraph") ?? false);

  // Case-insensitive heading lookup
  const archLower = findSection(sections, "architecture");
  assert("case-insensitive lookup", archLower !== null);

  // Lookup with # prefix
  const archHash = findSection(sections, "## Architecture");
  assert("lookup with ## prefix", archHash !== null);
}

// ---------------------------------------------------------------------------
console.log("\n── describeSections ──");
{
  const doc = "# Title\n\nIntro.\n\n## API\n\nThe API does things.\n";
  const desc = describeSections(doc);
  assert("contains heading", desc.includes("# Title") || desc.includes("Title"));
  assert("contains block index", desc.includes("[0]"));
}

// ---------------------------------------------------------------------------
console.log("\n── replaceBlock ──");
{
  const doc = `# Doc

## Section One

First paragraph here.

Second paragraph here.

## Section Two

Other content.
`;

  const replaced = replaceBlock(doc, "Section One", 1, "The replacement paragraph.");
  assert("replacement applied", replaced.includes("The replacement paragraph."));
  assert("first paragraph preserved", replaced.includes("First paragraph here."));
  assert("section two preserved", replaced.includes("Section Two"));
  assert("old second paragraph gone", !replaced.includes("Second paragraph here."));
}

// ---------------------------------------------------------------------------
console.log("\n── insertBlockAfter ──");
{
  const doc = `# Doc

## Section

Only paragraph here.
`;

  const inserted = insertBlockAfter(doc, "Section", 0, "Inserted paragraph.");
  assert("inserted content present", inserted.includes("Inserted paragraph."));
  assert("original preserved", inserted.includes("Only paragraph here."));
  // Inserted should come after the original
  assert(
    "inserted after original",
    inserted.indexOf("Inserted paragraph.") > inserted.indexOf("Only paragraph here."),
  );
}

// ---------------------------------------------------------------------------
console.log("\n── deleteBlock ──");
{
  const doc = `# Doc

## Section

Keep this.

Delete this.

Keep this too.
`;

  const deleted = deleteBlock(doc, "Section", 1);
  assert("deleted content gone", !deleted.includes("Delete this."));
  assert("first block preserved", deleted.includes("Keep this."));
  assert("third block preserved", deleted.includes("Keep this too."));
}

// ---------------------------------------------------------------------------
console.log("\n── appendToSection ──");
{
  const doc = `# Doc

## Section

Existing paragraph.

## Next

Other content.
`;

  const result = appendToSection(doc, "Section", "Appended paragraph.");
  assert("appended content present", result.includes("Appended paragraph."));
  assert("original preserved", result.includes("Existing paragraph."));
  assert("next section preserved", result.includes("## Next"));
  assert(
    "appended before next section",
    result.indexOf("Appended paragraph.") < result.indexOf("## Next"),
  );
  assert(
    "appended after existing",
    result.indexOf("Appended paragraph.") > result.indexOf("Existing paragraph."),
  );
}

// ---------------------------------------------------------------------------
console.log("\n── renameSection ──");
{
  const doc = `# Doc

## Old Name

Content here.

## Other

More.
`;

  const result = renameSection(doc, "Old Name", "New Name");
  assert("new heading present", result.includes("## New Name"));
  assert("old heading gone", !result.includes("## Old Name"));
  assert("content preserved", result.includes("Content here."));
  assert("other section preserved", result.includes("## Other"));

  // With # prefix in new name — should strip it
  const result2 = renameSection(doc, "Old Name", "## New Name");
  assert("strips # prefix from new name", result2.includes("## New Name") && !result2.includes("## ## New Name"));
}

// ---------------------------------------------------------------------------
console.log("\n── deleteSection ──");
{
  const doc = `# Doc

## Keep This

Keep content.

## Delete This

Delete content.

More to delete.

## Also Keep

Also keep content.
`;

  const result = deleteSection(doc, "Delete This");
  assert("deleted heading gone", !result.includes("## Delete This"));
  assert("deleted content gone", !result.includes("Delete content."));
  assert("deleted multi-block gone", !result.includes("More to delete."));
  assert("first section preserved", result.includes("## Keep This"));
  assert("last section preserved", result.includes("## Also Keep"));
}

// ---------------------------------------------------------------------------
console.log("\n── addSection ──");
{
  const doc = `# Doc

## Section A

Content A.

## Section B

Content B.
`;

  const newSection = "## Section C\n\nContent C.";
  const result = addSection(doc, "Section A", newSection);
  assert("new section present", result.includes("## Section C"));
  assert("new content present", result.includes("Content C."));
  assert("section A preserved", result.includes("## Section A"));
  assert("section B preserved", result.includes("## Section B"));
  assert(
    "new section between A and B",
    result.indexOf("## Section C") > result.indexOf("## Section A") &&
      result.indexOf("## Section C") < result.indexOf("## Section B"),
  );

  // Add at end
  const result2 = addSection(doc, "(end)", "## Section Z\n\nContent Z.");
  assert("end: new section present", result2.includes("## Section Z"));
  assert(
    "end: after section B",
    result2.indexOf("## Section Z") > result2.indexOf("## Section B"),
  );
}

// ---------------------------------------------------------------------------
console.log("\n── error cases ──");
{
  const doc = "# Doc\n\n## Only Section\n\nContent.\n";

  // Section not found
  try {
    replaceBlock(doc, "Nonexistent Section", 0, "new");
    assert("should have thrown for missing section", false);
  } catch (e: any) {
    assert("throws for missing section", e.message.includes("not found"));
  }

  // Block index out of range
  try {
    replaceBlock(doc, "Only Section", 99, "new");
    assert("should have thrown for bad index", false);
  } catch (e: any) {
    assert("throws for bad block index", e.message.includes("not found"));
  }
}

// ---------------------------------------------------------------------------
console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
