# pi-mdiff

Markdown-aware edit tools for [pi coding agent](https://github.com/earendil-works/pi-coding-agent).

Fixes the core problem: **standard `SEARCH/REPLACE` blocks break on markdown prose** because
formatters like [flowmark](https://github.com/jlevy/flowmark) and prettier soft-wrap paragraphs at
different line widths.
The same paragraph content that the LLM read as one long line might live across 4 physical lines on
disk — causing `edit` to fail even when the content is correct.

## What it does

**1. Normalizes `edit` SEARCH blocks on `.md` files** (transparent, no LLM change required)

Intercepts `edit` tool calls on markdown files and normalizes the SEARCH block before matching: joins
soft-wrapped lines, collapses extra blank lines, normalizes list bullets.
Fenced code blocks inside markdown are never touched.

If the built-in `edit` still fails after normalization, `pi-mdiff` reads the file itself, applies a
fuzzy normalized match, and transparently recovers — returning a success result instead of surfacing
the error to the LLM.

**2. Adds `md_inspect` — show section/block structure**

```
md_inspect path="docs/architecture.md"
```

Returns a structured map of every heading and the blocks inside it (with 0-based indices), so the LLM
knows what to pass to `md_edit`.

**3. Adds `md_edit` — section-anchored editing**

```
md_edit path="docs/architecture.md"
        operation="replace"
        section="## Database Layer"
        block_index=1
        content="We use PostgreSQL for all persistent storage..."
```

Anchors to a section heading + block index instead of exact text.
Line-reflowing formatters cannot break this.
Supports `replace`, `insert_after`, and `delete`.

**4. Injects system prompt guidance**

Tells the LLM to prefer `md_edit` for prose paragraphs and `edit` for code blocks inside markdown.

## Install

```bash
# Project-local (recommended — auto-installs for all agents on the project)
pi install -l git:github.com/jacobwang/pi-mdiff

# Global
pi install git:github.com/jacobwang/pi-mdiff

# Test without installing
pi -e ./src/index.ts
```

## How it works

### The normalization problem

```
# Same paragraph, two valid line-wrapping styles:

## Flowmark (semantic line breaks)          ## Prettier (80-char wrap)
The system uses PostgreSQL                  The system uses PostgreSQL for all
for all persistent storage.                 persistent storage. The schema is
The schema is defined in                    defined in `schema.sql`.
`schema.sql`.
```

Both render identically.
But if the LLM read the flowmark version and emits a SEARCH block with the 80-char-wrapped text,
`edit` fails with "cannot find matching context."

`pi-mdiff` normalizes both sides — the SEARCH block and the file — before comparing, so formatting
differences are invisible to the matching logic.

### The block-anchor approach

For larger rewrites (rewriting a whole paragraph), even normalized matching can fail if the LLM
changes sentence structure.
`md_edit` skips text matching entirely:

1. Parse the file into an mdast AST
2. Walk to the section matching the heading
3. Replace the nth block node
4. Serialize back to markdown

No text matching = no fragility from reformatting.

### What's never touched

- Fenced code blocks (` ``` `) — normalized/matched using regular `edit` as before
- YAML frontmatter
- HTML blocks

## File structure

```
src/
  index.ts      Main extension — hooks, tool registrations, system prompt
  normalize.ts  Prose normalization + fuzzy text matching
  ast.ts        mdast-based block operations (replaceBlock, insertBlockAfter, deleteBlock)
  test.ts       36 unit tests (run with: npx tsx src/test.ts)
```

## Development

```bash
npm install
npx tsx src/test.ts     # run tests
pi -e ./src/index.ts    # test in pi
```
