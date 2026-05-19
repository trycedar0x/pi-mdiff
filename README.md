# pi-mdiff

Markdown-aware edit tools for [pi coding agent](https://github.com/earendil-works/pi-coding-agent).

Fixes the core problem: **standard `SEARCH/REPLACE` blocks break on markdown prose** because
formatters like [flowmark](https://github.com/jlevy/flowmark) and prettier soft-wrap paragraphs at
different line widths.
The same paragraph content that the LLM read as one long line might live across 4 physical lines on
disk — causing `edit` to fail even when the content is correct.

## What it does

**1. Normalizes `edit` SEARCH blocks on `.md` files** (transparent, no LLM change required)

Intercepts `edit` tool calls on markdown files and normalizes the SEARCH block before matching:
joins soft-wrapped lines within paragraphs, collapses extra blank lines, normalizes list bullets.

The normalizer is structure-aware — it never touches fenced code blocks, YAML frontmatter, table
rows, blockquotes, headings, or list items. Only prose paragraphs are joined.

If the built-in `edit` still fails after normalization, `pi-mdiff` reads the file itself, applies a
fuzzy normalized match, and transparently recovers — returning a success result instead of surfacing
the error to the LLM.

**2. Adds `md_inspect` — show section/block structure**

```
md_inspect path="docs/architecture.md"
```

Returns a structured map of every heading and the blocks inside it (with 0-based indices), so the
LLM knows what to pass to `md_edit`.

**3. Adds `md_edit` — section-anchored editing**

```
md_edit path="docs/architecture.md"
        operation="replace"
        section="## Database Layer"
        block_index=1
        content="We use PostgreSQL for all persistent storage..."
```

Anchors to a section heading + block index instead of exact text. Line-reflowing formatters cannot
break this. Supports `replace`, `insert_after`, and `delete`.

**4. Injects system prompt guidance**

Tells the LLM to prefer `md_edit` for prose paragraphs and `edit` for code blocks inside markdown.

## Install

```bash
# Project-local (recommended — auto-installs for all agents on the project)
pi install -l git:github.com/trycedar0x/pi-mdiff

# Global
pi install git:github.com/trycedar0x/pi-mdiff

# Test without installing
pi -e ./src/index.ts
```

## How it works

### The normalization problem

```
# Same paragraph, two valid line-wrapping styles — both render identically:

## Flowmark (semantic line breaks)      ## Prettier (80-char wrap)
The system uses PostgreSQL              The system uses PostgreSQL for all
for all persistent storage.             persistent storage. The schema is
The schema is defined in                defined in `schema.sql`.
`schema.sql`.
```

If the LLM read the flowmark version and emits a SEARCH block with the 80-char-wrapped text,
`edit` fails with "cannot find matching context."

`pi-mdiff` normalizes both sides — the SEARCH block and the file — before comparing, so formatting
differences are invisible to the matching logic.

### What the normalizer preserves (never joined)

| Element | Example |
|---|---|
| Fenced code blocks | ` ``` ` … ` ``` ` |
| YAML frontmatter | `---\ntitle: …\n---` |
| Table rows | `\| Col A \| Col B \|` |
| Headings | `## Section Name` |
| List items (any indent) | `- item`, `  - nested` |
| Blockquotes | `> quoted text` |
| Horizontal rules | `---`, `***` |
| Explicit line breaks | line ending with two spaces |
| HTML blocks | `<!-- comment -->`, `<div>` |

### The block-anchor approach

For larger rewrites, even normalized matching can fail if the LLM changes sentence structure.
`md_edit` skips text matching entirely:

1. Parse the file into an mdast AST
2. Walk to the section matching the heading (case-insensitive, ignores leading `#`)
3. Replace / insert after / delete the nth block node
4. Splice back into the source at exact character offsets

No text matching = no fragility from reformatting.

## File structure

```
src/
  index.ts      Extension entry — hooks, tool registrations, system prompt injection
  normalize.ts  Prose normalization (splitSegments, normalizeProse, findInMarkdown)
  ast.ts        AST operations (replaceBlock, insertBlockAfter, deleteBlock, describeSections)
  test.ts       36 unit tests
  eval.ts       64 scenario evals across 5 categories (see below)
```

## Eval coverage

```
npm run eval
```

64 cases, 100% pass rate:

| Category  | Cases | What it covers |
|-----------|-------|----------------|
| normalize | 20    | Every element type: tables, frontmatter, fences, lists, blockquotes, headings, setext, unicode, bullet normalization |
| find      | 10    | Reflow recovery: 2-line/3-line join, reverse reflow, flowmark vs 80-char, multi-paragraph SEARCH, no-match |
| md_edit   | 15    | replace / insert_after / delete + blast-radius + frontmatter preservation + error cases |
| reflow    | 9     | Full 3×3 source-format × search-format matrix (all 6 off-diagonal mismatches pass) |
| edge      | 10    | Empty files, preamble content, duplicate headings, 500-word paragraphs, inline code, links |

## Development

```bash
npm install
npm test          # 36 unit tests
npm run eval      # 64 scenario evals
npm run typecheck # tsc strict type check
pi -e ./src/index.ts  # load in pi for manual testing
```
