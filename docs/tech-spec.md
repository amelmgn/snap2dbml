# Technical Specification: snap2dbml

## 1. Overview / Context

This document specifies the technical architecture and implementation details for `snap2dbml`, a developer tool that converts Directus JSON schema snapshots into DBML (Database Markup Language) format.

**Reference PRD**: [spec-output.md](spec-output.md)

**Core Problem**: Directus stores schema information in a proprietary JSON format that cannot be directly consumed by database diagramming tools. This tool bridges that gap by translating Directus snapshots into the standardized DBML format.

**Technical Scope**: A quad-mode npm package providing:
1. A CLI binary (`snap2dbml`) for command-line usage
2. A programmatic Node.js library for integration into build pipelines
3. A stateless HTTP backend service (`src/server.ts`) for automation workflows (n8n, webhooks, external tooling), deployable via Docker
4. A built-in sync engine (`src/syncer.ts` + `src/scheduler.ts`) that fetches snapshots from Directus and pushes converted files to GitHub in a single commit on a cron schedule

## 2. Goals and Non-Goals

### Goals
- Parse Directus JSON snapshot format (v10.x, v11.x)
- Generate valid, deterministic DBML output
- Provide CLI, library, and HTTP server interfaces
- Achieve <2s processing for 200 collections / 2,000 fields on GitHub Actions `ubuntu-latest` runner
- Zero runtime dependencies for core library (excluding CLI argument parser)
- Full TypeScript type safety
- Comprehensive error handling with actionable messages
- HTTP server deployable as a Docker container with API key authentication

### Non-Goals
- YAML snapshot support
- Reverse conversion (DBML → Directus)
- Direct integration with visualization services
- Schema migration (applying schema changes to a database)
- GUI or web interface
- Real-time schema monitoring
- Built-in TLS termination (delegated to nginx or similar reverse proxy)
- GitHub webhook receiver (sync is pull-based, not push-triggered)

## 3. System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        snap2dbml                            │
├─────────────────────────────────────────────────────────────┤
│  CLI Entry Point (bin/snap2dbml.js)                         │
│    ├── snap2dbml [file]  → convert snapshot                 │
│    └── snap2dbml sync    → fetch + convert + GitHub commit  │
├─────────────────────────────────────────────────────────────┤
│  HTTP Server Entry Point (src/server.ts)                    │
│    ├── POST /convert  → { dbml, md, warnings, stats, meta } │
│    ├── GET  /health   → { status: "ok" }                    │
│    └── SYNC_CONFIG env → auto-starts SyncScheduler          │
├─────────────────────────────────────────────────────────────┤
│  Sync Entry Point (src/sync.ts)                             │
│    ├── loadSyncConfig(path): SyncConfig                     │
│    ├── runSync(target): Promise<void>                       │
│    └── SyncScheduler: start() / stop() / runAll()           │
├─────────────────────────────────────────────────────────────┤
│  Library Entry Point (src/index.ts)                         │
│    ├── convertSnapshot(snapshot, options): string           │
│    ├── convertSnapshotString(json, options): string         │
│    ├── convertSnapshotWithStats(snapshot, options): Result  │
│    ├── convertSnapshotToMarkdown(snapshot, options): Result │
│    ├── generateMarkdown(schema, options): string            │
│    └── Exports: All public types & errors                   │
├─────────────────────────────────────────────────────────────┤
│  Core Modules                                               │
│    ├── parser.ts       → Parse & validate Directus JSON     │
│    ├── transformer.ts  → Convert to intermediate repr       │
│    ├── generator.ts    → Generate DBML string output        │
│    ├── md-generator.ts → Generate Markdown output           │
│    └── types.ts        → Type definitions                   │
├─────────────────────────────────────────────────────────────┤
│  Sync Modules                                               │
│    ├── sync-config.ts  → Load & validate sync.json          │
│    ├── github-client.ts→ Git Data API (single commit)       │
│    ├── syncer.ts       → Orchestrate one sync cycle         │
│    └── scheduler.ts    → In-process cron scheduler          │
├─────────────────────────────────────────────────────────────┤
│  Utilities                                                  │
│    ├── type-map.ts    → Directus → DBML type mappings       │
│    ├── errors.ts      → Custom error classes                │
│    ├── constants.ts   → Codes, limits, prefixes             │
│    └── validator.ts   → Input validation utilities          │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

```
Input (JSON string or object)
    │
    ▼
┌──────────────┐
│   Parser     │ → Validates JSON structure, version, & size limits
└──────────────┘   Throws InvalidSnapshotError if invalid
    │              Max input size: 50MB (configurable)
    ▼
┌──────────────┐
│ Transformer  │ → Converts Directus schema to intermediate model
└──────────────┘   Filters system collections (unless --include-system)
    │              Resolves relationships (M2O, O2M, M2M, O2O)
    │              Detects circular references (warning by default)
    ├──────────────────────────────────────┐
    ▼                                      ▼
┌──────────────┐                 ┌─────────────────┐
│ DBML Gen.    │                 │  MD Generator   │ (optional: --md or
└──────────────┘                 └─────────────────┘  generateMarkdown)
    │ Deterministic ordering          │ Per-collection GFM tables
    │ Escapes special characters      │ Field/Type/Required/Relation/Settings
    ▼                                 ▼
DBML output                      Markdown output
```

## 4. Component Design

### 4.1 Parser Module (`src/parser.ts`)

**Responsibility**: Validate and parse Directus snapshot JSON with size and depth limits.

```typescript
interface ParserOptions {
  includeSystem?: boolean;
  maxSizeBytes?: number; // Default: 50 * 1024 * 1024 (50MB)
  maxDepth?: number;     // Default: 100
}

function parseSnapshot(input: unknown, options?: ParserOptions): DirectusSnapshot;
function parseSnapshotString(json: string, options?: ParserOptions): DirectusSnapshot;
```

**Validation Rules**:
1. Input must be a non-null object
2. Must have `version` property with value `1` (v10.x) or `4` (v11.x)
3. Must have `directus` property (string, non-empty)
4. Must have `collections` array
5. Must have `fields` array
6. Must have `relations` array (can be empty)
7. Each collection must have `collection` (string) and `meta` (object|null)
8. Each field must have `collection`, `field`, `type`, `meta`, and `schema`
9. No duplicate collection names (case-insensitive)
10. No duplicate field names within same collection

**Version Handling**:
- v10.x: `version: 1`, `directus` field contains version (e.g., "10.10.0")
- v11.x: `version: 4`, `directus` field contains version (e.g., "11.0.0")
- Unknown versions: Throw `InvalidSnapshotError` (code `INVALID_SNAPSHOT`) with a message listing supported versions

### 4.2 Transformer Module (`src/transformer.ts`)

**Responsibility**: Convert parsed Directus snapshot to intermediate schema model.

```typescript
interface TransformOptions {
  includeSystem?: boolean;
  includeComments?: boolean;
  failOnCircularReference?: boolean;
}

interface TransformResult {
  schema: SchemaModel;
  warnings: TransformWarning[];
  circularReferences: string[];
}

function transformSnapshot(snapshot: DirectusSnapshot, options?: TransformOptions): TransformResult;
```

**Key Operations**:
1. Filter collections starting with `directus_` (unless `includeSystem`)
2. Group fields by collection
3. Identify primary keys from `schema.is_primary_key` (warn `MULTIPLE_PRIMARY_KEYS` if a collection has more than one)
4. Resolve relationships using algorithm below
5. Detect circular references (iterative DFS over the full reference graph)
6. Map Directus field types to DBML types
7. Format default values (strings are escaped for DBML: quotes, backslashes, newlines; objects serialized as JSON)
8. Extract comments from `meta.note` if `includeComments`
9. Collect virtual relationship aliases as `virtualFields` on each table; aliases whose name collides with a real column are dropped with a `DUPLICATE_VIRTUAL_FIELD` warning (see below)

**Relationship Resolution Algorithm**:
```
For each relation in snapshot.relations:
  If meta.junction_field exists → M2M relationship
  Else if meta.many_collection and meta.one_collection both exist:
    If meta.many_field is null → O2M (skip; covered by the M2O side)
    Else if the FK column (many_collection.many_field) has a unique
         or primary-key constraint (schema.is_unique / is_primary_key) → O2O
    Else → M2O
  Else → Skip (incomplete), log warning INCOMPLETE_RELATION

If referenced collection was filtered out → Skip, log warning DANGLING_RELATION
```

Note: `meta.one_field` is **not** an O2O indicator — it merely means a reverse
O2M alias field exists on the "one" side. O2O is determined solely by a
uniqueness constraint on the FK column.

**Virtual Field Collection**:

Directus `alias` fields with `type: "alias"` have no physical database column but may represent relationships visible in the Directus UI. When an alias field's `meta.special` array contains a relationship indicator (`o2m`, `m2m`, or `translations`), it is collected as a virtual field on the parent table's `virtualFields` array. Pure UI layout aliases (where `meta.special` contains `alias`, `no-data`, `group`) are silently skipped.

```
For each field where type === 'alias':
  If meta.special contains 'o2m', 'm2m', or 'translations':
    → Add { name: field.field, kind: matched_special } to table.virtualFields
  Else:
    → Skip silently (UI group / presentation alias)
```

### 4.3 Generator Module (`src/generator.ts`)

**Responsibility**: Produce deterministic DBML string output.

```typescript
function generateDBML(schema: SchemaModel, options?: GeneratorOptions): string;
```

**Determinism Requirements**:
- Tables sorted alphabetically (case-insensitive, `localeCompare('en')`)
- Columns sorted: primary keys first (in order), then alphabetically
- References sorted by `${fromTable}.${fromColumn}`
- Indentation: 2 spaces
- Line endings: LF only
- No trailing whitespace

**DBML Output Format**:
```dbml
Table customers {
  id int [pk]
  email varchar(255) [not null]
  name varchar(100)
  created_at timestamp [default: `now()`]

  // orders [o2m]
}

Ref: orders.customer_id > customers.id
```

**Virtual Fields as Comments**:

If a table has `virtualFields`, they are rendered as `// name [kind]` comment lines after a blank separator line, before any table-level `Note:` and before the closing `}`. Virtual fields are sorted alphabetically for determinism.

**Special Character Escaping**:
- Backticks: `\``
- Single quotes: `\'`
- Newlines in comments: replace with space

### 4.4 HTTP Server Module (`src/server.ts`)

**Responsibility**: Expose the conversion pipeline as a stateless HTTP service. Uses Node.js built-in `node:http` — no additional runtime dependencies. Optionally starts the sync scheduler on boot.

**Endpoints**:

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | Liveness check; returns `{"status":"ok"}` |
| POST | `/convert` | `X-API-Key` | Convert snapshot; returns DBML + optional Markdown |

**Request body** (`POST /convert`):

```typescript
{
  snapshot: DirectusSnapshot;      // required
  generateMarkdown?: boolean;      // default: false
  options?: ConvertOptions;        // passed to convertSnapshotWithStats / convertSnapshotToMarkdown
}
```

**Response** (HTTP 200):

```typescript
{
  dbml: string;
  md: string | null;               // null when generateMarkdown is false
  warnings: ConversionWarning[];
  stats: ConversionStats;
  metadata: ConversionMetadata;
}
```

**Error responses**:

| Status | Condition |
|--------|-----------|
| 401 | `X-API-Key` header missing or incorrect (when `API_KEY` env var is set) |
| 400 | Malformed JSON or missing `snapshot` field |
| 404 | Unknown method/path |
| 413 | Request body exceeds 50 MB |
| 422 | Snapshot conversion failed with a known error (`Snap2DBMLError`, e.g. `InvalidSnapshotError`) |
| 500 | Unexpected internal error — details logged server-side, generic message returned |

The `X-API-Key` header is compared in constant time (`crypto.timingSafeEqual`). An invalid `PORT` env value fails fast at startup instead of binding a random port.

**Configuration** (environment variables):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | TCP port to listen on |
| `API_KEY` | `""` | Expected value of `X-API-Key` header; empty = auth disabled |
| `SYNC_CONFIG` | `""` | Path to `sync.json`. When set, `SyncScheduler` is started on server boot and stopped on `server.close()`. |

**Behaviour notes**:
- `suppressWarnings: true` is applied by default so warnings go to the response body, not stderr
- Body size is hard-limited to 50 MB at the HTTP layer before JSON parsing
- The server is stateless — no files are written to disk
- If `SYNC_CONFIG` is set but the file is invalid, an error is logged and the server continues running (scheduler not started)

### 4.5 Markdown Generator Module (`src/md-generator.ts`)

**Responsibility**: Produce a human-readable Markdown document describing all collections and their fields.

```typescript
interface MdGeneratorOptions {
  includeComments?: boolean;
}

function generateMarkdown(schema: SchemaModel, options?: MdGeneratorOptions): string;
```

**Output Format**: GitHub Flavored Markdown (GFM). One `### \`collection_name\`` section per collection, each containing a table with columns:

| Column | Source |
|--------|--------|
| **Field** | Column name, wrapped in backticks |
| **Type** | DBML type from the intermediate model |
| **Required** | `Yes` if `!isNullable` (NOT NULL constraint), otherwise `No` |
| **Relation** | `Primary key` / `M2O to {table}` / `{KIND} → {collection}` for virtual fields / `--` |
| **Settings** | `Auto-generated` for PKs; `Foreign Key` for FKs; default value if set; notes if `includeComments`; `--` if none |

**Sorting**: Same as DBML generator — tables alphabetically, PKs first then columns alphabetically, virtual fields alphabetically.

**Example output**:
```markdown
### `posts`

| Field | Type | Required | Relation | Settings |
| ----- | ---- | -------- | -------- | -------- |
| `id` | uuid | Yes | Primary key | Auto-generated |
| `author_id` | uuid | No | M2O to authors | Foreign Key |
| `title` | varchar(255) | Yes | -- | -- |
```

### 4.6 Type Mapping (`src/type-map.ts`)

| Directus Type | DBML Type |
|---------------|-----------|
| `uuid` | `uuid` |
| `string` | `varchar(255)` |
| `text` | `text` |
| `integer` | `int` |
| `bigInteger` | `bigint` |
| `float` | `float` |
| `decimal` | `decimal(10,2)` |
| `boolean` | `boolean` |
| `timestamp` | `timestamp` |
| `dateTime` | `datetime` |
| `date` | `date` |
| `time` | `time` |
| `json` | `json` |
| `csv` | `text` |
| `hash` | `varchar(255)` |
| `alias` | *(skip column; annotate as comment if `meta.special` contains `o2m`/`m2m`/`translations`)* |
| `presentation`, `group` | *(skip)* |
| unknown | `text` + warning |

**Resolution Priority**:
1. `schema.data_type` if available
2. `type` field mapped via TYPE_MAP
3. Fallback to `text` with warning

### 4.7 Constants (`src/constants.ts`)

```typescript
export const ERROR_CODES = {
  INVALID_SNAPSHOT: 'INVALID_SNAPSHOT',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  CIRCULAR_REFERENCE: 'CIRCULAR_REFERENCE',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;

export const WARNING_CODES = {
  UNKNOWN_FIELD_TYPE: 'UNKNOWN_FIELD_TYPE',
  MULTIPLE_PRIMARY_KEYS: 'MULTIPLE_PRIMARY_KEYS',
  INCOMPLETE_RELATION: 'INCOMPLETE_RELATION',
  DANGLING_RELATION: 'DANGLING_RELATION',
  DUPLICATE_VIRTUAL_FIELD: 'DUPLICATE_VIRTUAL_FIELD',
  CIRCULAR_REFERENCE_DETECTED: 'CIRCULAR_REFERENCE_DETECTED',
} as const;

export const SYSTEM_COLLECTION_PREFIX = 'directus_';
export const DEFAULT_MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
export const DEFAULT_MAX_DEPTH = 100;
```

### 4.8 Error Classes (`src/errors.ts`)

```typescript
abstract class Snap2DBMLError extends Error {
  abstract readonly code: string;
  abstract getExitCode(): number;
}

class InvalidSnapshotError extends Snap2DBMLError {
  readonly code = 'INVALID_SNAPSHOT';
  getExitCode() { return 1; }
  constructor(message: string, public readonly path?: string, public readonly validationErrors?: string[]) { ... }
}

class CircularReferenceError extends Snap2DBMLError {
  readonly code = 'CIRCULAR_REFERENCE';
  getExitCode() { return 5; }
}

class FileTooLargeError extends Snap2DBMLError {
  readonly code = 'FILE_TOO_LARGE';
  getExitCode() { return 4; }
}

class ValidationError extends Snap2DBMLError {
  readonly code = 'VALIDATION_ERROR';
  getExitCode() { return 1; }
}
```

### 4.9 Sync Modules (`src/sync-config.ts`, `src/github-client.ts`, `src/syncer.ts`, `src/scheduler.ts`)

**Responsibility**: Automate the full snapshot lifecycle — fetch from Directus, convert, push to GitHub in a single commit — without any external orchestrator.

#### Config (`src/sync-config.ts`)

```typescript
interface SyncTarget {
  name: string;                    // Unique identifier for this target
  schedule: string;                // 5-field cron expression, e.g. "0 0 * * 1-5"
  directus: {
    snapshotUrl: string;           // Directus snapshot export URL
    bearerToken: string;           // Directus static token
  };
  github: {
    owner: string;                 // GitHub account or org
    repo: string;                  // Repository name
    branch?: string;               // Default: "main"
    token: string;                 // GitHub PAT with repo write scope
    snapshotPath: string;          // e.g. "Directus/snapshot/snapshot.json"
    schemaDir: string;             // e.g. "Directus/schema"
  };
  telegram?: {
    botToken: string;
    chatId: string;
    notifyOn?: 'success' | 'failure' | 'always'; // Default: 'success'
  };
  generateMarkdown?: boolean;      // Default: false
  convertOptions?: ConvertOptions;
}
```

`loadSyncConfig(path)` loads the JSON file, substitutes `${ENV_VAR}` placeholders from `process.env`, and validates all required fields plus name uniqueness. Telegram configuration is optional; when present, its credentials and notification mode are validated at load time.

#### GitHub Client (`src/github-client.ts`)

Uses `fetch` (Node 18 built-in) with a 30-second `AbortSignal` timeout on every call.

Single-commit flow via GitHub Git Data API:
1. `GET /git/ref/heads/{branch}` → current commit SHA
2. `GET /git/commits/{sha}` → base tree SHA
3. For each changed file: `POST /git/blobs` → blob SHA (or `sha: null` for deletion)
4. `POST /git/trees` → new tree SHA (base_tree + all changes at once)
5. `POST /git/commits` → new commit SHA
6. `PATCH /git/refs/heads/{branch}` → advance ref

This produces exactly **one commit** regardless of how many files are added, updated, or deleted.

#### Syncer (`src/syncer.ts`)

`runSync(target)` orchestrates one sync cycle:
1. Fetch snapshot from Directus (with Bearer auth, 30 s timeout)
2. Convert via `buildConversionArtifacts` (DBML + optional Markdown)
3. List existing `(schema|description)_<timestamp>.(dbml|md)` files in `schemaDir` (matches both current `YYYYMMDD_HHMMSS` and legacy `YYMMDD_HHMMSS` formats; new files are named with the UTC timestamp, matching the commit message)
4. Build change list: new `snapshot.json` + new schema files + deletions of old schema files (paths about to be written are excluded from deletions, so a rerun within the same second cannot produce duplicate tree paths)
5. Call `createSingleCommit` — one commit, one push
6. On success, send Telegram notification when `notifyOn` is `success` or `always`. A successful no-change run (`committed: false`) is still a success and is notified.
7. On failure, send Telegram notification when `notifyOn` is `failure` or `always`, then rethrow the original sync error.

Telegram delivery is non-fatal: transport and non-2xx errors are logged without changing the sync outcome. Failure messages contain a bounded error reason and do not include credentials or snapshot payloads. The internal `src/telegram.ts` module owns delivery and notification-policy matching.

#### Scheduler (`src/scheduler.ts`)

`SyncScheduler` manages per-target `setTimeout`-based jobs (no runtime dependencies):

- **Cron parser** supports: values (`5`), wildcards (`*`), ranges (`1-5`), lists (`1,3,5`), steps (`*/15`, `8-17/2`). Minute, hour, and day-of-week fields are evaluated; day-of-month and month fields must be `*` (anything else is rejected with an error). `7` is accepted as Sunday. Non-numeric, out-of-range, inverted-range, and zero-step values throw a descriptive error instead of silently never matching.
- `start()`: registers a timer for each target; timers are `unref()`'d so they don't prevent process exit if the HTTP server stops.
- `stop()`: clears all timers.
- `runAll()`: runs all targets in parallel (`Promise.allSettled`); throws if any target failed (non-zero exit from CLI).
- `runByName(name)`: runs a single named target.
- On completion of each run, `scheduleNext()` is called to re-register the next timer.

**Known limitation**: two targets pointing to the same GitHub repo+branch run in parallel and may race on the branch ref update. Keep targets pointed at different repos, or stagger their schedules.

## 5. API Design

### 5.1 Library API (`src/index.ts`)

```typescript
// === Main conversion functions ===

export function convertSnapshot(snapshot: DirectusSnapshot, options?: ConvertOptions): string;
export function convertSnapshotString(json: string, options?: ConvertOptions): string;
export function convertSnapshotWithStats(snapshot: DirectusSnapshot, options?: ConvertOptions): ConvertResult;

// Generates a Markdown collection description alongside (not instead of) DBML
export function convertSnapshotToMarkdown(snapshot: DirectusSnapshot, options?: ConvertOptions): MarkdownConvertResult;

// Low-level: generate Markdown directly from an intermediate SchemaModel
export function generateMarkdown(schema: SchemaModel, options?: MdGeneratorOptions): string;

// === Options ===

export interface ConvertOptions {
  /** Include directus_* system collections. Default: false */
  includeSystem?: boolean;
  /** Include table/column comments from meta.note. Default: false */
  includeComments?: boolean;
  /** Maximum input size in bytes. Default: 52428800 (50MB) */
  maxSizeBytes?: number;
  /** Maximum JSON nesting depth. Default: 100 */
  maxDepth?: number;
  /** Suppress warnings to console. Default: false */
  suppressWarnings?: boolean;
  /** Throw error on circular reference. Default: false (warning) */
  failOnCircularReference?: boolean;
}

export interface MdGeneratorOptions {
  /** Include table/column notes from meta.note. Default: false */
  includeComments?: boolean;
}

// === Result types ===

export interface ConvertResult {
  dbml: string;
  warnings: ConversionWarning[];
  stats: ConversionStats;
  metadata: ConversionMetadata;
}

export interface MarkdownConvertResult {
  markdown: string;
  warnings: ConversionWarning[];
  stats: ConversionStats;
  metadata: ConversionMetadata;
}

export interface ConversionWarning {
  code: string;
  message: string;
  collection?: string;
  field?: string;
  path?: string;
}

export interface ConversionStats {
  tablesProcessed: number;
  tablesExcluded: number;
  fieldsProcessed: number;
  fieldsSkipped: number;
  relationsProcessed: number;
  circularReferences: number;
  durationMs: number;
}

export interface ConversionMetadata {
  directusVersion: string;
  snapshotVersion: number;
  generatedAt: string;
  snap2dbmlVersion: string;
}

// === Re-exports ===

export type { DirectusSnapshot, DirectusCollection, DirectusField, DirectusRelation };
export type { SchemaModel, TableModel, ColumnModel, ReferenceModel };
export { buildConversionArtifacts };  // single-pass DBML + Markdown conversion
export { Snap2DBMLError, InvalidSnapshotError, CircularReferenceError, ValidationError, FileTooLargeError };
export { ERROR_CODES, WARNING_CODES } from './constants';
```

### 5.2 HTTP Server API (`src/server.ts`)

See section 4.4 for full specification. Summary:

```
GET  /health               → 200 {"status":"ok"}
POST /convert              → 200 {dbml, md, warnings, stats, metadata}
                           → 400 {error} — bad JSON or missing snapshot
                           → 401 {error} — invalid or missing API key
                           → 413 {error} — body too large (>50MB)
                           → 422 {error} — conversion failed (known Snap2DBMLError)
                           → 500 {error} — unexpected internal error (generic message)
```

Run with Docker:
```bash
cp docker/.env.example docker/.env
docker build -t snap2dbml:local .
docker run --rm --env-file docker/.env -e SYNC_CONFIG= -p 3001:3000 snap2dbml:local
```

Run without Docker:
```bash
npm run build && npm start
```

### 5.3 CLI Interface (`bin/snap2dbml.js`)

```
Usage: snap2dbml [options] [file]
       snap2dbml sync [options]

Convert Directus JSON snapshots to DBML format

Arguments:
  file                      Path to snapshot file (reads stdin if omitted or '-')

Options:
  -o, --output <file>       Write output to file instead of stdout
  --stdout                  Explicitly output to stdout
  --md                      Also generate a Markdown collection description file alongside DBML
  --include-system          Include Directus system collections (directus_*)
  --include-comments        Include table/column comments from meta.note
  --max-size <mb>           Maximum input size in MB (default: 50)
  --fail-on-circular        Exit with error on circular references
  --suppress-warnings       Suppress warning messages to stderr
  -v, --verbose             Show stats/metadata as JSON after output
  -q, --quiet               Suppress all non-error output (implies --suppress-warnings)
  --version                 Show version number
  -h, --help                Show help

Subcommand: sync
  Fetch snapshots from Directus, convert, and push to GitHub in a single commit.

  Options:
    --config <file>         Path to sync config JSON (default: "sync.json")
    --name <name>           Run only the named sync target (runs all if omitted)

  Exit Codes:
    0   All targets succeeded
    1   One or more targets failed (details logged to stderr)

Exit Codes (main command):
  0   Success
  1   Invalid input / processing error
  2   File not found
  3   Permission denied
  4   Input file too large
  5   Circular reference detected (with --fail-on-circular)

Examples:
  snap2dbml snapshot.json
  snap2dbml snapshot.json --md
  snap2dbml snapshot.json -o schema.dbml
  snap2dbml --include-system < snapshot.json
  cat snapshot.json | snap2dbml -o schema.dbml --verbose
  snap2dbml sync --config sync.json
  snap2dbml sync --config sync.json --name relian
```

**CLI Behavior**:
- All files read/written in UTF-8 encoding
- Output path must resolve within CWD (no path traversal)
- `--md`: Generates both `schema_YYYYMMDD_HHMMSS.dbml` and `description_YYYYMMDD_HHMMSS.md` in the output folder. When `--output` is specified, DBML goes to the given path and MD is written to the same path with `.md` extension. MD is not generated when `--stdout` is used.
- `--verbose`: Appends stats/metadata as JSON line after DBML output
- `--quiet`: No stderr output except fatal errors

**`settings.json` keys**:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `inputFolder` | string | — | Folder scanned for snapshot JSON when no file argument given |
| `outputFolder` | string | `"output"` | Folder where generated files are written |
| `cleanOutput` | boolean | `false` | Delete previous `.dbml` (and `.md` when MD is enabled) before writing |
| `generateMarkdown` | boolean | `false` | Same as `--md`: also generate a Markdown file alongside DBML |

## 6. Data Models

### 6.1 Directus Snapshot Structure (Input)

```typescript
interface DirectusSnapshot {
  version: 1 | 4;           // 1 = Directus 10.x, 4 = Directus 11.x
  directus: string;         // Version string, e.g., "10.10.0"
  vendor?: string;          // Database vendor: postgres, mysql, sqlite, etc.
  collections: DirectusCollection[];
  fields: DirectusField[];
  relations: DirectusRelation[];
}

interface DirectusCollection {
  collection: string;
  meta: {
    collection: string;
    icon?: string | null;
    note?: string | null;
    hidden: boolean;
    singleton: boolean;
  } | null;
  schema?: {
    name: string;
  } | null;
}

interface DirectusField {
  collection: string;
  field: string;
  type: string;
  meta: {
    id: number;
    collection: string;
    field: string;
    special?: string[] | null;
    required?: boolean;
    note?: string | null;
  } | null;
  schema: {
    name: string;
    table: string;
    data_type: string;
    default_value?: unknown;
    is_nullable: boolean;
    is_unique?: boolean;
    is_primary_key: boolean;
    has_auto_increment?: boolean;
    max_length?: number | null;
    numeric_precision?: number | null;
    numeric_scale?: number | null;
  } | null;
}

interface DirectusRelation {
  collection: string;
  field: string;
  related_collection: string | null;
  meta: {
    many_collection: string;
    many_field: string;
    one_collection: string | null;
    one_field: string | null;
    junction_field?: string | null;
  } | null;
  schema?: {
    constraint_name: string;
    table: string;
    column: string;
    foreign_key_table: string;
    foreign_key_column: string;
    on_update: string;
    on_delete: string;
  } | null;
}
```

### 6.2 Intermediate Schema Model

```typescript
interface SchemaModel {
  tables: TableModel[];
  references: ReferenceModel[];
  metadata: SchemaMetadata;
}

interface TableModel {
  name: string;
  columns: ColumnModel[];
  comment?: string;
  isSystem: boolean;
  virtualFields?: { name: string; kind: string }[];  // alias relationship annotations
}

interface ColumnModel {
  name: string;
  type: string;
  isPrimaryKey: boolean;
  isNullable: boolean;
  defaultValue?: string;
  comment?: string;
}

interface ReferenceModel {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  relation: '>' | '<' | '-';  // many-to-one, one-to-many, one-to-one
}

interface SchemaMetadata {
  directusVersion: string;
  snapshotVersion: number;
  vendor?: string;
  generatedAt: string;
}
```

## 7. Infrastructure Requirements

### 7.1 Package Structure

```
snap2dbml/
├── bin/
│   └── snap2dbml.js
├── src/
│   ├── index.ts           ← library entry point
│   ├── server.ts          ← HTTP server entry point
│   ├── sync.ts            ← sync barrel entry point
│   ├── sync-config.ts     ← sync.json types & loader
│   ├── github-client.ts   ← GitHub Git Data API client
│   ├── syncer.ts          ← single sync cycle orchestrator
│   ├── scheduler.ts       ← in-process cron scheduler
│   ├── conversion.ts      ← shared conversion pipeline
│   ├── parser.ts
│   ├── transformer.ts
│   ├── generator.ts
│   ├── md-generator.ts
│   ├── type-map.ts
│   ├── errors.ts
│   ├── constants.ts
│   ├── types.ts
│   ├── version.ts
│   └── validator.ts
├── dist/
│   ├── index.js
│   ├── index.d.ts
│   ├── index.js.map
│   ├── server.js          ← compiled server (no .d.ts)
│   ├── server.js.map
│   ├── sync.js            ← compiled sync modules (no .d.ts)
│   └── sync.js.map
├── tests/
│   ├── fixtures/
│   │   ├── basic.json
│   │   ├── relationships-m2o.json
│   │   ├── relationships-m2m.json
│   │   ├── utf8-names.json
│   │   ├── large-schema.json
│   │   ├── directus-10.json
│   │   ├── directus-11.json
│   │   └── malformed/
│   ├── unit/
│   ├── integration/
│   └── fuzz/
├── benchmarks/
├── Dockerfile             ← two-stage build (builder + runtime)
├── docker/
│   ├── docker-compose.yml  ← mutually exclusive prod and stage services
│   └── .env.example        ← shared runtime and image-tag configuration
├── .dockerignore
├── sync.example.json      ← sync config template
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
└── README.md
```

### 7.2 package.json

```json
{
  "name": "snap2dbml",
  "version": "1.0.0",
  "description": "Convert Directus JSON snapshots to DBML format",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "snap2dbml": "./bin/snap2dbml.js"
  },
  "files": ["dist", "bin"],
  "scripts": {
    "build": "tsup",
    "start": "node dist/server.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:fuzz": "vitest run tests/fuzz/",
    "benchmark": "node benchmarks/run.js",
    "lint": "eslint src tests",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "npm run build && npm test"
  },
  "engines": { "node": ">=18.0.0" },
  "dependencies": {
    "commander": "^12.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@vitest/coverage-v8": "^2.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.0.0",
    "vitest": "^2.0.0",
    "eslint": "^9.0.0",
    "fast-check": "^3.0.0"
  }
}
```

### 7.3 tsup.config.ts

Three separate build configurations — library (with `.d.ts`), server, and sync modules (both without `.d.ts`):

```typescript
import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    minify: false,
    target: 'node18',
  },
  {
    entry: ['src/server.ts'],
    format: ['esm'],
    dts: false,
    clean: false,
    sourcemap: true,
    minify: false,
    target: 'node18',
  },
  {
    entry: ['src/sync.ts'],
    format: ['esm'],
    dts: false,
    clean: false,
    sourcemap: true,
    minify: false,
    target: 'node18',
  },
]);
```

## 8. Security Considerations

| Threat | Mitigation | Implementation |
|--------|------------|----------------|
| Malicious JSON | Validate structure; no eval() | JSON.parse() + schema validation |
| Path traversal (--output) | Resolve and validate path | path.resolve(); check within CWD |
| Prototype pollution | Object.hasOwn() checks | Avoid spreading unknown objects |
| Resource exhaustion | Size/depth limits | maxSizeBytes (50MB), maxDepth (100); HTTP body hard-limited to 50MB before parsing |
| Stack overflow | Depth limits; iterative algorithms | maxDepth in parser |
| Sensitive data exposure | Schema only, no data | Filter values during parsing |
| Unauthorized HTTP access | API key authentication | `X-API-Key` header checked against `API_KEY` env var; 401 on mismatch |
| HTTP brute-force | Reverse proxy rate limiting | Handled by nginx or similar; not built into the server |
| TLS/HTTPS | Reverse proxy termination | nginx + Certbot on VPS; server itself speaks plain HTTP |

## 9. Error Handling Strategy

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Invalid input / processing error |
| 2 | File not found |
| 3 | Permission denied |
| 4 | Input too large |
| 5 | Circular reference (with --fail-on-circular) |

### Error Message Format

```
snap2dbml: INVALID_SNAPSHOT: Missing required 'collections' array

Details:
  Path: root

Suggestion: Ensure you are using a valid Directus snapshot file.
```

## 10. Performance Requirements

| Metric | Target | Verification |
|--------|--------|--------------|
| 200 collections, 2000 fields | <2s P95 | Benchmark on GitHub Actions ubuntu-latest |
| 50 collections, 500 fields | <500ms P95 | Benchmark |
| Memory (200 collections) | <100MB heap | Memory profiling |
| CLI startup | <100ms | Cold start measurement |

### Optimization Strategies
1. Single-pass JSON parsing
2. Array join for string building
3. Lazy sorting (only at output)
4. No regex in hot paths

## 11. Testing Strategy

### Coverage Targets
- Line coverage: ≥90%
- Branch coverage: ≥85%
- Public API: 100%

### Test Categories

| Category | Tools | Description |
|----------|-------|-------------|
| Unit | Vitest | Parser, transformer, generator modules |
| Integration | Vitest | CLI flags, API functions |
| Snapshot | Vitest | Deterministic output verification |
| Fuzz | fast-check | Malformed input handling |
| Performance | Custom | Benchmark against targets |

### Test Fixtures

| Fixture | Purpose |
|---------|---------|
| basic.json | Simple schema |
| relationships-m2o.json | Many-to-one |
| relationships-m2m.json | Many-to-many with junction |
| utf8-names.json | Non-ASCII names |
| large-schema.json | 200 collections, 2000 fields |
| directus-10.json | v10.x format (version: 1) |
| directus-11.json | v11.x format (version: 4) |
| malformed/*.json | Invalid inputs |

## 12. Deployment Strategy

### npm Publishing (CLI / Library)

```bash
npm version patch|minor|major
npm publish
```

### HTTP Server — VPS (Docker)

Images are published by CI on every push to `stage` and `prod` branches, tagged with the branch name and an immutable `sha-<short>`. No `latest` tag is published. A single Compose project defines separate `prod` and profile-gated `stage` services; both bind host port `3000` and share `.env` plus the optional `sync.json` mount, so only one service may run at a time.

```bash
# Initial production deployment
git clone <repo> && cd snap2dbml
cp docker/.env.example docker/.env  # set API_KEY, GHCR_OWNER, and sync credentials
cd docker
docker compose pull prod
docker compose up -d prod

# Replace production temporarily with the stage build
docker compose --profile stage pull stage
docker compose stop prod
docker compose --profile stage up -d stage

# After publishing the tested commit under :prod, switch back
docker compose pull prod
docker compose --profile stage stop stage
docker compose up -d prod

# nginx reverse proxy (HTTP → localhost:PORT)
# Certbot for HTTPS
```

Both containers remain in the same Compose project, but the shared host port and scheduler configuration make them mutually exclusive. The `stage` profile prevents an untargeted `docker compose up` from starting both. A manually stopped service remains stopped across Docker daemon restarts because both services use `restart: unless-stopped`.

The Dockerfile uses a two-stage build:
1. **builder** — installs all deps, runs `npm run build`
2. **runtime** — `node:22-alpine` + production deps only + compiled `dist/`

The container exposes port `3000` internally, and both Compose services publish it as host port `3000` so nginx configuration does not change during a switch.

A `HEALTHCHECK` directive pings `/health` every 30s; Docker marks the container unhealthy after 3 consecutive failures.

### HTTP Server — Without Docker

```bash
npm run build
npm start        # node dist/server.js
```

Use PM2 for process management:
```bash
pm2 start dist/server.js --name snap2dbml
pm2 save && pm2 startup
```

### Release Checklist

1. All tests pass
2. TypeScript compiles
3. CHANGELOG updated
4. Version bumped
5. Git tag created

### Rollback Procedure

```bash
npm deprecate snap2dbml@X.Y.Z "Critical bug, use X.Y.W instead"
npm publish  # New fixed version
```

For Docker, a failed stage test is rolled back by stopping `stage` and starting the existing stopped `prod` container. To roll back an already updated production service, set `PROD_IMAGE_TAG` in `docker/.env` to the previous immutable `sha-*` tag, pull `prod`, and run `docker compose up -d prod`.

### Versioning Policy

- **Patch**: Bug fixes, performance improvements
- **Minor**: New features (backward compatible), new Directus version support, HTTP server enhancements
- **Major**: Breaking API changes, dropped Node.js version support, breaking HTTP API changes

## 13. Open Questions / Future Considerations

| Item | Status | Notes |
|------|--------|-------|
| Streaming for large snapshots | Deferred | 200 tables fits in memory |
| Custom type mapping config | Deferred | Add based on user feedback |
| YAML snapshot support | Out of scope | PRD excludes |
| DBML TableGroups | Future | Could map to Directus folders |
| Column notes | Implemented | Via --include-comments |
| Virtual relationship aliases | Implemented | O2M/M2M/translations alias fields rendered as `virtual` columns with notes; aliases colliding with real column names are dropped with a warning |
| HTTP backend service | Implemented | POST /convert via node:http, Docker deployment |
| HTTP rate limiting | Deferred | Delegated to nginx reverse proxy |
| Directus v12+ support | Future | Monitor format changes |
| GitHub sync (single commit) | Implemented | `snap2dbml sync` command + daemon mode via SYNC_CONFIG |
| Multi-repo sync | Implemented | Multiple entries in `syncs[]` array, each independent |
| Race condition on same repo (two targets) | Known limitation | User responsibility to avoid; stagger schedules if needed |
| Day-of-month / month cron fields | Known limitation | Must be `*`; non-wildcard values are rejected with an error. Only minute/hour/dow evaluated |
| Tests for sync modules | Partial | Cron parser covered by `tests/unit/scheduler.test.ts`; sync-config, syncer, github-client still untested |
