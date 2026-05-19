/**
 * Markdown AST utilities for block-level editing.
 *
 * Parses markdown into an mdast tree and provides:
 * - Section listing (headings + their block children)
 * - Block replacement by section heading + block index
 * - Serialization back to markdown
 */

import { fromMarkdown } from "mdast-util-from-markdown";
import { toString as mdastToString } from "mdast-util-to-string";
import type { Root, Heading, Content, Parent } from "mdast";

export type BlockLocation = {
  /** The heading text to anchor to, e.g. "## Architecture" or just "Architecture" */
  section: string;
  /** 0-based index of the block within that section */
  blockIndex: number;
};

export type Section = {
  headingDepth: number;
  headingText: string;
  /** 0-based start line in the source */
  startLine: number;
  /** character offset of the heading node's start in the original source (0 for preamble) */
  headingStartOffset: number;
  /** character offset just after the heading node in the original source (0 for preamble) */
  headingEndOffset: number;
  blocks: SectionBlock[];
};

export type SectionBlock = {
  index: number;
  type: string;
  text: string;
  /** character offset in original source */
  startOffset: number;
  endOffset: number;
};

/**
 * Parse a markdown document and return its sections with block metadata.
 */
export function parseSections(source: string): Section[] {
  const tree = fromMarkdown(source);
  const sections: Section[] = [];

  // Add a virtual "top-level" section for content before the first heading
  let currentSection: Section = {
    headingDepth: 0,
    headingText: "(preamble)",
    startLine: 0,
    headingStartOffset: 0,
    headingEndOffset: 0,
    blocks: [],
  };

  for (const node of tree.children) {
    if (node.type === "heading") {
      // Save current section if it has content
      if (currentSection.blocks.length > 0 || sections.length > 0) {
        sections.push(currentSection);
      }
      currentSection = {
        headingDepth: node.depth,
        headingText: mdastToString(node),
        startLine: node.position?.start.line ?? 0,
        headingStartOffset: node.position?.start.offset ?? 0,
        headingEndOffset: node.position?.end.offset ?? 0,
        blocks: [],
      };
    } else {
      const startOffset = node.position?.start.offset ?? 0;
      const endOffset = node.position?.end.offset ?? 0;
      currentSection.blocks.push({
        index: currentSection.blocks.length,
        type: node.type,
        text: mdastToString(node),
        startOffset,
        endOffset,
      });
    }
  }

  sections.push(currentSection);
  return sections;
}

/**
 * Normalize a heading query: strip leading #s and trim whitespace for comparison.
 */
function normalizeHeading(h: string): string {
  return h.replace(/^#+\s*/, "").trim().toLowerCase();
}

/**
 * Find a section by heading text (case-insensitive, ignores leading #s).
 */
export function findSection(sections: Section[], heading: string): Section | null {
  const normalized = normalizeHeading(heading);
  return sections.find((s) => normalizeHeading(s.headingText) === normalized) ?? null;
}

/**
 * Replace a specific block in a markdown document.
 *
 * @param source       Original markdown source
 * @param sectionHeading  Heading text to anchor to (e.g. "## Architecture")
 * @param blockIndex   0-based index of the block within the section
 * @param newContent   New block content (raw markdown prose)
 * @returns Modified markdown source
 * @throws  If section or block is not found
 */
export function replaceBlock(
  source: string,
  sectionHeading: string,
  blockIndex: number,
  newContent: string,
): string {
  const sections = parseSections(source);
  const section = findSection(sections, sectionHeading);

  if (!section) {
    const available = sections.map((s) => `"${s.headingText}"`).join(", ");
    throw new Error(
      `Section "${sectionHeading}" not found. Available sections: ${available}`,
    );
  }

  const block = section.blocks[blockIndex];
  if (!block) {
    throw new Error(
      `Block index ${blockIndex} not found in section "${section.headingText}". ` +
        `Section has ${section.blocks.length} block(s) (indices 0–${section.blocks.length - 1}).`,
    );
  }

  // Splice the new content into the source at the block's character offsets.
  // Preserve the trailing newline structure by looking at what follows the block.
  const before = source.slice(0, block.startOffset);
  const after = source.slice(block.endOffset);

  // Ensure the replacement ends with a newline if the original did
  const trailingNewline = after.startsWith("\n") ? "" : "\n";
  return before + newContent.trimEnd() + trailingNewline + after;
}

/**
 * Insert a new block after a specific block in a section.
 */
export function insertBlockAfter(
  source: string,
  sectionHeading: string,
  blockIndex: number,
  newContent: string,
): string {
  const sections = parseSections(source);
  const section = findSection(sections, sectionHeading);

  if (!section) {
    const available = sections.map((s) => `"${s.headingText}"`).join(", ");
    throw new Error(
      `Section "${sectionHeading}" not found. Available sections: ${available}`,
    );
  }

  const block = section.blocks[blockIndex];
  if (!block) {
    throw new Error(
      `Block index ${blockIndex} not found in section "${section.headingText}".`,
    );
  }

  const before = source.slice(0, block.endOffset);
  const after = source.slice(block.endOffset);

  return before + "\n\n" + newContent.trimEnd() + after;
}

/**
 * Delete a specific block in a section.
 */
export function deleteBlock(
  source: string,
  sectionHeading: string,
  blockIndex: number,
): string {
  const sections = parseSections(source);
  const section = findSection(sections, sectionHeading);

  if (!section) {
    const available = sections.map((s) => `"${s.headingText}"`).join(", ");
    throw new Error(
      `Section "${sectionHeading}" not found. Available sections: ${available}`,
    );
  }

  const block = section.blocks[blockIndex];
  if (!block) {
    throw new Error(
      `Block index ${blockIndex} not found in section "${section.headingText}".`,
    );
  }

  // Remove the block and any immediately following blank line
  let start = block.startOffset;
  let end = block.endOffset;

  // Eat leading blank line before block (to avoid leaving a double blank)
  if (start > 0 && source[start - 1] === "\n" && source[start - 2] === "\n") {
    start -= 1;
  }

  // Eat trailing newline
  if (source[end] === "\n") end += 1;

  return source.slice(0, start) + source.slice(end);
}

/**
 * Append a new block at the end of a section.
 */
export function appendToSection(
  source: string,
  sectionHeading: string,
  newContent: string,
): string {
  const sections = parseSections(source);
  const sectionIdx = sections.findIndex(
    (s) => normalizeHeading(s.headingText) === normalizeHeading(sectionHeading),
  );
  if (sectionIdx === -1) {
    const available = sections.map((s) => `"${s.headingText}"`).join(", ");
    throw new Error(`Section "${sectionHeading}" not found. Available sections: ${available}`);
  }

  const section = sections[sectionIdx];
  let insertAt: number;
  if (section.blocks.length > 0) {
    insertAt = section.blocks[section.blocks.length - 1].endOffset;
  } else {
    // Empty section — insert after the heading line
    insertAt = section.headingEndOffset;
  }

  return source.slice(0, insertAt) + "\n\n" + newContent.trimEnd() + source.slice(insertAt);
}

/**
 * Rename a section heading (preserves heading depth).
 */
export function renameSection(
  source: string,
  sectionHeading: string,
  newHeadingText: string,
): string {
  const sections = parseSections(source);
  const section = findSection(sections, sectionHeading);
  if (!section) {
    const available = sections.map((s) => `"${s.headingText}"`).join(", ");
    throw new Error(`Section "${sectionHeading}" not found. Available sections: ${available}`);
  }
  if (section.headingDepth === 0) {
    throw new Error(`Cannot rename the preamble section.`);
  }
  const prefix = "#".repeat(section.headingDepth) + " ";
  return (
    source.slice(0, section.headingStartOffset) +
    prefix +
    newHeadingText.replace(/^#+\s*/, "").trim() +
    source.slice(section.headingEndOffset)
  );
}

/**
 * Delete an entire section (heading + all its blocks).
 * Removes up to the start of the next sibling section or end of file.
 */
export function deleteSection(source: string, sectionHeading: string): string {
  const sections = parseSections(source);
  const sectionIdx = sections.findIndex(
    (s) => normalizeHeading(s.headingText) === normalizeHeading(sectionHeading),
  );
  if (sectionIdx === -1) {
    const available = sections.map((s) => `"${s.headingText}"`).join(", ");
    throw new Error(`Section "${sectionHeading}" not found. Available sections: ${available}`);
  }

  const section = sections[sectionIdx];
  if (section.headingDepth === 0) {
    throw new Error(`Cannot delete the preamble section. Use deleteBlock to remove individual blocks.`);
  }

  const nextSection = sections[sectionIdx + 1];
  const sectionEnd = nextSection ? nextSection.headingStartOffset : source.length;

  // Eat the blank line(s) immediately before this heading
  let start = section.headingStartOffset;
  while (start > 0 && source[start - 1] === "\n") start--;
  // Keep one newline to avoid merging surrounding content
  if (start < section.headingStartOffset) start += 1;

  return source.slice(0, start) + source.slice(sectionEnd);
}

/**
 * Add a new section after the given section (or at the end of the file if
 * afterSection is "(end)"). newSectionContent should be full markdown including
 * the heading line, e.g. "## New Section\n\nParagraph text here."
 */
export function addSection(
  source: string,
  afterSection: string,
  newSectionContent: string,
): string {
  if (afterSection === "(end)") {
    return source.trimEnd() + "\n\n" + newSectionContent.trimEnd() + "\n";
  }

  const sections = parseSections(source);
  const sectionIdx = sections.findIndex(
    (s) => normalizeHeading(s.headingText) === normalizeHeading(afterSection),
  );
  if (sectionIdx === -1) {
    const available = sections.map((s) => `"${s.headingText}"`).join(", ");
    throw new Error(`Section "${afterSection}" not found. Available sections: ${available}`);
  }

  const nextSection = sections[sectionIdx + 1];
  // Insert just before the next section's heading (which already has \n\n before it)
  // or at end of file
  const insertAt = nextSection ? nextSection.headingStartOffset : source.length;

  if (nextSection) {
    // There's already \n\n before the next heading; insert our block right before it
    return (
      source.slice(0, insertAt) +
      newSectionContent.trimEnd() +
      "\n\n" +
      source.slice(insertAt)
    );
  } else {
    return source.trimEnd() + "\n\n" + newSectionContent.trimEnd() + "\n";
  }
}

/**
 * Return a human-readable summary of all sections and blocks for the LLM to use
 * when calling md_edit.
 */
export function describeSections(source: string): string {
  const sections = parseSections(source);
  const lines: string[] = [];

  for (const section of sections) {
    if (section.headingText === "(preamble)" && section.blocks.length === 0) continue;
    const prefix = section.headingDepth > 0 ? "#".repeat(section.headingDepth) + " " : "";
    lines.push(`${prefix}${section.headingText}`);
    for (const block of section.blocks) {
      const preview = block.text.slice(0, 60).replace(/\n/g, " ");
      const ellipsis = block.text.length > 60 ? "…" : "";
      lines.push(`  [${block.index}] ${block.type}: "${preview}${ellipsis}"`);
    }
  }

  return lines.join("\n");
}
