# pi-mdiff

**Markdown has a granularity problem that code doesn't. In code, a line is a unit of meaning. In markdown, a *paragraph* is — but it can span 1 line or 10 depending on who last ran the formatter. pi-mdiff fixes this for the pi coding agent.**

[![npm version](https://img.shields.io/npm/v/@trycedar/pi-mdiff?style=flat-square)](https://www.npmjs.com/package/@trycedar/pi-mdiff)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](https://opensource.org/licenses/MIT)
[![pi-package](https://img.shields.io/badge/pi-package-8b5cf6?style=flat-square)](https://pi.dev/packages/pi-mdiff)

## The problem

Every line-based tool — git diff, AI SEARCH blocks, blame — assumes lines are meaningful units. In code they are. In markdown they aren't.

A paragraph like this:

```
The system uses PostgreSQL for all storage.
The schema is defined in schema.sql.
All queries go through the repository layer.
```

…is identical in meaning to this:

```
The system uses PostgreSQL for all storage. The schema is defined in schema.sql. All queries go through the repository layer.
```

A formatter rewraps it. Now your diff shows three deleted lines and one added line — but nothing changed. And when pi tries to edit the file, SEARCH fails because it's matching at the wrong granularity.

```
Error: cannot find matching context in docs/architecture.md
<<<<<<< SEARCH
The system uses PostgreSQL for all storage.
The schema is defined in schema.sql.
All queries go through the repository layer.
```

**pi-mdiff fixes this by operating at paragraph and block level instead of line level.**

## Install

```bash
pi install npm:@trycedar/pi-mdiff
```

No config, no API keys.

## Try this first

After installing, ask pi naturally:

```text
Update the Architecture section of docs/README.md to mention that we moved to PostgreSQL.
```

```text
Inspect docs/CONTRIBUTING.md and rewrite the Getting Started section.
```

```text
Delete the "Legacy Notes" section from docs/api.md.
```

```text
Add a new "Troubleshooting" section after Installation in README.md.
```

pi will use `md_inspect` to find the right section and `md_edit` to apply the change — no fragile text matching involved.

## What this adds

### Transparent fix for `edit` on `.md` files

Every `edit` call on a markdown file is intercepted. SEARCH blocks are normalized to paragraph granularity before matching — soft-wrapped lines joined, blank lines collapsed, bullets standardized. Fenced code and frontmatter are never touched.

**Before pi-mdiff:** formatter reflows paragraph → SEARCH fails → LLM retries → confusion.

**After pi-mdiff:** normalization runs silently → match found → edit applied → done.

If normalization still can't match, fuzzy recovery kicks in and returns success. The LLM never sees the error.

### `md_inspect` — see section structure before editing

```
md_inspect path="docs/architecture.md"
```

```
## Overview
  [0] paragraph: "This project is a web application that helps…"
## Database Layer
  [0] paragraph: "We use PostgreSQL for all persistent storage…"
  [1] paragraph: "Migrations are managed via Alembic…"
## API Layer
  [0] paragraph: "The REST API is built with Express…"
```

Shows every section heading and the blocks inside it, with 0-based indices. Call this before `md_edit` so you know exactly what to target.

### `md_edit` — section-anchored editing

```
md_edit path="docs/architecture.md"
        operation="replace"
        section="## Database Layer"
        block_index=0
        content="We use PostgreSQL for all persistent storage.
The schema is defined in schema.sql and managed via Alembic."
```

Anchors to a heading + block index. No text matching at all. Formatters can reflow the entire file — this still works.

| Operation | What it does |
|---|---|
| `replace` | Replace the block at `block_index` with new content |
| `insert_after` | Insert a new block after `block_index` |
| `delete` | Remove the block at `block_index` |
| `append` | Add a new block at the end of the section |
| `rename_section` | Rename the section heading itself |
| `delete_section` | Remove the entire section including its heading |
| `add_section` | Insert a brand-new section after another; `content` includes the heading line |

## Common workflows

| Task | How to ask |
|---|---|
| Update a specific section | "Rewrite the Deployment section of docs/README.md to mention Docker." |
| Add content to a section | "Add a note about rate limiting at the end of the Authentication section." |
| Add a new section | "Add a Troubleshooting section after Installation in README.md." |
| Rename a section | "Rename the 'Legacy API' section to 'Deprecated API' in docs/api.md." |
| Delete stale content | "Remove the 'Legacy API' section from docs/api.md." |
| Bulk doc update | "Update all references to 'SQLite' to 'PostgreSQL' in docs/architecture.md." |
| Inspect before editing | "Show me the structure of CONTRIBUTING.md before we edit it." |

## What the normalizer preserves

Only prose lines are joined. Everything structurally meaningful is left exactly as-is:

| Element | Example | Touched? |
|---|---|---|
| Fenced code blocks | ` ``` `…` ``` ` | Never |
| YAML frontmatter | `---\ntitle: …\n---` | Never |
| Table rows | `\| Col A \| Col B \|` | Never |
| Headings | `## Section Name` | Never |
| List items | `- item`, `  - nested` | Never |
| Blockquotes | `> quoted text` | Never |
| Horizontal rules | `---`, `***` | Never |
| Explicit line breaks | line ending with `  ` | Never |
| Inline code | `` `code` `` | Never |

## Tools

### `md_inspect`

| Parameter | Description |
|---|---|
| `path` | Path to the markdown file (.md only) |

Returns a formatted section map with block type and preview text. Use before `md_edit` to find the right `section` and `block_index`.

### `md_edit`

| Parameter | Description |
|---|---|
| `path` | Path to the markdown file (.md only) |
| `operation` | See table above |
| `section` | Heading text to anchor to — case-insensitive, `##` prefix optional. For `add_section`: the section to insert after (use `(end)` to append at end of file) |
| `block_index` | 0-based index of the target block (not needed for `append`, `rename_section`, `delete_section`, `add_section`) |
| `content` | New content — required for `replace`, `insert_after`, `append`, `add_section`; new heading text for `rename_section` |

> **Note:** `md_edit` and `md_inspect` support `.md` and `.markdown` files only. For `.mdx` files, use the built-in `edit` tool (normalization still applies automatically).

## How it works

**Normalization path** (fixes `edit` calls transparently):

```
LLM calls edit() on .md file
  → pi-mdiff intercepts tool_call
  → normalizes SEARCH block to paragraph granularity
  → built-in edit runs with normalized text
  → if still fails: fuzzy findInMarkdown(), writes file, returns success
```

**Block-anchor path** (`md_edit`, most robust):

```
LLM calls md_edit()
  → parse file into mdast AST
  → find section by heading (case-insensitive)
  → locate nth block node
  → splice at exact character offsets
  → write file
```

## Eval coverage

```bash
npm run eval   # 79 cases, 100% pass rate
```

| Category | Cases | Covers |
|---|---|---|
| normalize | 20 | Tables, frontmatter, fences, lists, blockquotes, headings, setext, unicode |
| find | 10 | 2-line/3-line reflow, reverse reflow, flowmark vs 80-char, multi-paragraph, no-match |
| md_edit | 30 | All 7 operations, blast-radius, frontmatter, section ops, error cases |
| reflow | 9 | 3×3 format matrix — all 6 off-diagonal mismatches recover correctly |
| edge | 10 | Empty files, preamble, duplicate headings, long paragraphs, inline code |

## Development

```bash
git clone https://github.com/trycedar0x/pi-mdiff
cd pi-mdiff && npm install
npm test          # 58 unit tests
npm run eval      # 79 scenario evals
npm run typecheck # strict TypeScript check
pi -e ./src/index.ts  # load in pi for manual testing
```
