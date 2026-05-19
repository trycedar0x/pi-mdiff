/**
 * pi-mdiff — Markdown-aware edit extension for pi coding agent
 *
 * Problems solved:
 *  1. Built-in `edit` uses exact SEARCH matching. Markdown prose is soft-wrapped
 *     by formatters (flowmark, prettier), so the same paragraph can live on
 *     different physical lines — causing SEARCH to fail even when content is right.
 *
 *  2. There is no way to target "the 2nd paragraph in the ## Architecture section"
 *     without copying the exact text, which the LLM often gets slightly wrong.
 *
 * What this extension does:
 *  - Intercepts `edit` tool calls on .md/.mdx files and normalizes SEARCH blocks
 *    before matching (joins soft-wrapped lines, collapses extra blank lines,
 *    normalizes bullets). Fenced code blocks are never touched.
 *  - Intercepts `tool_result` on failed `edit` calls and retries with normalized
 *    matching, transparently recovering without the LLM retrying.
 *  - Registers `md_edit` — a section-anchored replacement for `edit` on markdown.
 *    The LLM specifies a heading + block index instead of exact text to match.
 *  - Registers `md_inspect` — shows the section/block structure of a file so the
 *    LLM knows what heading + index to pass to `md_edit`.
 *  - Injects system prompt guidance to prefer `md_edit` for prose paragraphs.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

import { normalizeMarkdown, findInMarkdown } from "./normalize.js";
import { replaceBlock, insertBlockAfter, deleteBlock, describeSections } from "./ast.js";

function isMarkdownPath(path: string | undefined): boolean {
  if (!path) return false;
  return path.endsWith(".md") || path.endsWith(".mdx") || path.endsWith(".markdown");
}

// ---------------------------------------------------------------------------
// Track edit tool call inputs so we can retry on failure in tool_result
// ---------------------------------------------------------------------------
const pendingMarkdownEdits = new Map<
  string,
  { path: string; edits: Array<{ oldText: string; newText: string }> }
>();

export default function (pi: ExtensionAPI) {
  // -------------------------------------------------------------------------
  // Hook 1: Intercept `edit` tool calls on markdown files
  // Normalize SEARCH blocks so line-reflow doesn't break matching.
  // -------------------------------------------------------------------------
  pi.on("tool_call", async (event, _ctx) => {
    if (!isToolCallEventType("edit", event)) return;
    if (!isMarkdownPath(event.input.path)) return;

    // Remember the original inputs keyed by toolCallId for retry in tool_result
    pendingMarkdownEdits.set(event.toolCallId, {
      path: event.input.path,
      edits: event.input.edits.map((e: { oldText: string; newText: string }) => ({ ...e })),
    });

    // Normalize each SEARCH block in place (pi docs: mutations to event.input
    // take effect — the built-in edit tool sees the mutated values)
    for (const edit of event.input.edits) {
      const normalized = normalizeMarkdown(edit.oldText);
      if (normalized !== edit.oldText) {
        edit.oldText = normalized;
      }
    }
  });

  // -------------------------------------------------------------------------
  // Hook 2: Intercept failed `edit` results on markdown files
  // Try a manual fuzzy apply before surfacing the error to the LLM.
  // -------------------------------------------------------------------------
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "edit" || !event.isError) return;

    const pending = pendingMarkdownEdits.get(event.toolCallId);
    if (!pending || !isMarkdownPath(pending.path)) return;

    // Clean up
    pendingMarkdownEdits.delete(event.toolCallId);

    const absolutePath = resolve(ctx.cwd, pending.path);
    let source: string;
    try {
      source = await readFile(absolutePath, "utf-8");
    } catch {
      return; // Can't read — let original error stand
    }

    // Attempt to apply each edit manually using normalized matching
    let current = source;
    let allApplied = true;
    const applied: string[] = [];

    for (const edit of pending.edits) {
      const match = findInMarkdown(current, edit.oldText);
      if (!match) {
        allApplied = false;
        break;
      }
      current = current.slice(0, match.start) + edit.newText + current.slice(match.end);
      applied.push(edit.oldText.slice(0, 40).replace(/\n/g, "↵"));
    }

    if (!allApplied) return; // Give up, let the LLM see the original error

    // Write the recovered result
    try {
      await withFileMutationQueue(absolutePath, async () => {
        await writeFile(absolutePath, current, "utf-8");
      });
    } catch {
      return;
    }

    // Replace the error result with a success
    return {
      content: [
        {
          type: "text" as const,
          text:
            `Applied ${pending.edits.length} edit(s) to ${pending.path} ` +
            `using normalized markdown matching (soft-wrap recovery).`,
        },
      ],
      isError: false,
    };
  });

  // -------------------------------------------------------------------------
  // Tool: md_inspect
  // Shows the section/block structure of a markdown file.
  // The LLM calls this before md_edit to know what heading + index to use.
  // -------------------------------------------------------------------------
  pi.registerTool({
    name: "md_inspect",
    label: "Markdown Inspect",
    description:
      "Show the section and block structure of a markdown file. " +
      "Returns each heading and the blocks (paragraphs, lists, code, etc.) inside it, " +
      "with their 0-based indices. Use this before md_edit to find the right section and block_index.",
    promptSnippet: "Inspect markdown file structure (sections + block indices for md_edit)",
    promptGuidelines: [
      "Use md_inspect on .md files before md_edit to discover the correct section heading and block_index.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Path to the markdown file" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const absolutePath = resolve(ctx.cwd, params.path);
      const source = await readFile(absolutePath, "utf-8");
      const description = describeSections(source);
      return {
        content: [{ type: "text" as const, text: description }],
        details: {},
      };
    },
  });

  // -------------------------------------------------------------------------
  // Tool: md_edit
  // Section-anchored markdown editing — no exact text matching required.
  // -------------------------------------------------------------------------
  pi.registerTool({
    name: "md_edit",
    label: "Markdown Edit",
    description:
      "Edit a markdown file by section heading and block index. " +
      "More reliable than the built-in edit tool for prose — anchors to a heading and " +
      "block position rather than exact text, so line-reflowing formatters can't break it. " +
      "Use md_inspect first to find the right section and block_index. " +
      "Supported operations: replace (replace a block), insert_after (add a new block " +
      "after a block), delete (remove a block).",
    promptSnippet: "Edit markdown files by section heading + block index (use for .md prose)",
    promptGuidelines: [
      "Use md_edit instead of edit for prose paragraphs in .md and .mdx files.",
      "Always call md_inspect first to get the section heading and block_index for md_edit.",
      "Use the built-in edit tool for code blocks inside markdown (``` fences).",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Path to the markdown file" }),
      operation: StringEnum(["replace", "insert_after", "delete"] as const, {
        description: "replace: replace block content. insert_after: insert new block after this one. delete: remove block.",
      }),
      section: Type.String({
        description:
          'Heading text to anchor to, e.g. "## Architecture" or just "Architecture". ' +
          "Use (preamble) for content before the first heading.",
      }),
      block_index: Type.Number({
        description: "0-based index of the target block within the section (from md_inspect output)",
      }),
      content: Type.Optional(
        Type.String({
          description: "New block content (required for replace and insert_after, omit for delete)",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const absolutePath = resolve(ctx.cwd, params.path);

      return withFileMutationQueue(absolutePath, async () => {
        const source = await readFile(absolutePath, "utf-8");
        let result: string;

        switch (params.operation) {
          case "replace": {
            if (!params.content) throw new Error("content is required for replace operation");
            result = replaceBlock(source, params.section, params.block_index, params.content);
            break;
          }
          case "insert_after": {
            if (!params.content) throw new Error("content is required for insert_after operation");
            result = insertBlockAfter(source, params.section, params.block_index, params.content);
            break;
          }
          case "delete": {
            result = deleteBlock(source, params.section, params.block_index);
            break;
          }
          default: {
            const _exhaustive: never = params.operation;
            throw new Error(`Unknown operation: ${_exhaustive}`);
          }
        }

        await writeFile(absolutePath, result, "utf-8");

        return {
          content: [
            {
              type: "text" as const,
              text: `${params.operation} block ${params.block_index} in "${params.section}" in ${params.path}`,
            },
          ],
          details: {
            operation: params.operation,
            section: params.section,
            blockIndex: params.block_index,
          },
        };
      });
    },
  });

  // -------------------------------------------------------------------------
  // Hook 3: Inject system prompt guidance
  // Tell the LLM to prefer md_edit for prose and use md_inspect first.
  // -------------------------------------------------------------------------
  pi.on("before_agent_start", async (event, _ctx) => {
    return {
      systemPrompt:
        event.systemPrompt +
        `

## Markdown File Editing

When editing .md, .mdx, or .markdown files:

- For **prose paragraphs and lists**: prefer \`md_edit\` over \`edit\`.
  It anchors to a section heading and block index, so line-reflowing
  formatters cannot break it. Call \`md_inspect\` first to find the
  correct section and block_index.

- For **code blocks** (fenced \`\`\`): use the regular \`edit\` tool normally.
  Code blocks are never reflowed and exact matching works reliably.

- The built-in \`edit\` tool on markdown is still normalized automatically
  to handle soft line-wrap differences, but \`md_edit\` is more robust
  for large prose rewrites.`,
    };
  });
}
