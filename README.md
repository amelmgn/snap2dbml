## How it works

Convert [Directus](https://directus.io/) JSON schema snapshots into [DBML](https://dbml.dbdiagram.io/) (Database Markup Language) format for use with database diagramming tools.

## Why?

Directus stores schema in a proprietary JSON format that isn't compatible with standard database visualization tools. snap2dbml bridges that gap — giving you clean, diffable DBML output from your existing Directus snapshots, with no manual documentation needed.

## Installation

```bash
npm install snap2dbml
```

Requires **Node.js 18.0.0** and above.

## Quick Start

### Setup

Copy the example settings file and adjust paths to match your environment:

```bash
cp settings.example.json settings.json
```

Edit `settings.json` to configure your input and output folders:

```json
{
  "inputFolder": "./input",
  "outputFolder": "./output",
  "cleanOutput": true,
  "generateMarkdown": false
}
```

| Setting | Description |
|---------|-------------|
| `inputFolder` | Folder containing your Directus snapshot JSON file. Used when no file argument is passed. |
| `outputFolder` | Folder where generated files are written. |
| `cleanOutput` | When `true`, deletes previous timestamped `schema_*.dbml` outputs (and matching `description_*.md` files when `generateMarkdown` is enabled) from the managed `outputFolder` before writing new ones. Explicit `-o/--output` paths are never cleaned automatically. |
| `generateMarkdown` | When `true`, also generates a Markdown collection description file alongside the DBML output. |

Paths can be relative (to the working directory) or absolute.

### CLI

```bash
# Convert using settings.json (reads from inputFolder, writes to outputFolder)
snap2dbml

# Convert a specific snapshot file
snap2dbml snapshot.json

# Also generate a Markdown collection description alongside DBML
snap2dbml snapshot.json --md

# Write output to a specific file
snap2dbml snapshot.json -o schema.dbml

# Read from stdin
cat snapshot.json | snap2dbml
```

To make `snap2dbml` available globally (run from any directory):

```bash
npm link
```

### Library

```typescript
import { convertSnapshot, convertSnapshotString } from 'snap2dbml';

// From a parsed object
const dbml = convertSnapshot(snapshotObject);

// From a JSON string
const dbml = convertSnapshotString(jsonString);

// With options and statistics
import { convertSnapshotWithStats } from 'snap2dbml';

const result = convertSnapshotWithStats(snapshotObject, {
  includeSystem: false,
  includeComments: true,
});
// result.dbml       - DBML string
// result.warnings   - conversion warnings
// result.stats      - tables/fields/relations counts, duration
// result.metadata   - Directus version, generation timestamp

// Generate a Markdown collection description
import { convertSnapshotToMarkdown } from 'snap2dbml';

const mdResult = convertSnapshotToMarkdown(snapshotObject);
// mdResult.markdown  - Markdown string with per-collection field tables
// mdResult.warnings  - conversion warnings
// mdResult.stats     - tables/fields/relations counts, duration
// mdResult.metadata  - Directus version, generation timestamp

// DBML and Markdown in a single parse/transform pass
import { buildConversionArtifacts } from 'snap2dbml';

const artifacts = buildConversionArtifacts(snapshotObject, options, /* includeMarkdown */ true);
// artifacts.dbml      - DBML string
// artifacts.markdown  - Markdown string (only when includeMarkdown is true)
// artifacts.warnings / artifacts.stats / artifacts.metadata
```

### HTTP Server

snap2dbml can run as a stateless HTTP backend service — useful for automation via n8n, CI/CD pipelines, or any HTTP client.

**Local development:**

```bash
cp .env.example .env
# Set API_KEY in .env
docker compose -f docker-compose.dev.yml up -d --build
curl http://localhost:3001/health
```

**Production (VPS) — image pulled from GitHub Container Registry:**

```bash
cp .env.example .env
# Set API_KEY and GHCR_OWNER (your GitHub username) in .env
docker compose pull && docker compose up -d
```

The image is built and pushed automatically to `ghcr.io` on every push to the `stage` branch via GitHub Actions. No source code needed on the server.

**Endpoints:**

`GET /health` — no authentication required. Returns `{"status":"ok"}`.

`POST /convert` — convert a snapshot:

```bash
curl -X POST http://localhost:3000/convert \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret" \
  -d '{
    "snapshot": { ...Directus snapshot... },
    "generateMarkdown": true,
    "options": { "includeComments": true }
  }'
```

Response:

```json
{
  "dbml": "Table ...",
  "md": "# Collections...",
  "warnings": [],
  "stats": { "tablesProcessed": 5, "durationMs": 12 },
  "metadata": { "directusVersion": "11.0.0", "generatedAt": "..." }
}
```

`md` is `null` when `generateMarkdown` is omitted or `false`.

**Response status codes:**

| Status | Meaning |
|--------|---------|
| 200 | Conversion succeeded |
| 400 | Invalid JSON body or missing `snapshot` field |
| 401 | Missing or wrong `X-API-Key` |
| 404 | Unknown method/path |
| 413 | Request body exceeds the size limit (50 MB) |
| 422 | Snapshot failed validation or conversion |
| 500 | Internal error (details are logged server-side, not returned) |

**Environment variables:**

| Variable | Description |
|----------|-------------|
| `PORT` | Port to listen on (default: `3000`) |
| `API_KEY` | Secret for `X-API-Key` header. Leave empty to disable auth (not recommended). |
| `GHCR_OWNER` | Your GitHub username — used by `docker-compose.yml` to pull the image from `ghcr.io`. |
| `SYNC_CONFIG` | Path to a `sync.json` file. When set, the server auto-starts the sync scheduler on boot. |

### Automated GitHub Sync

snap2dbml can automatically pull snapshots from Directus and push the converted files to GitHub — no n8n or external scheduler needed. All changes land in **a single commit** per run.

**Setup:**

```bash
cp sync.example.json sync.json
# Fill in your Directus URL, tokens, and GitHub details
```

**`sync.json` format:**

```json
{
  "syncs": [
    {
      "name": "my-project",
      "schedule": "0 0 * * 1-5",
      "directus": {
        "snapshotUrl": "https://cms.example.com/schema/snapshot?export=json",
        "bearerToken": "${DIRECTUS_TOKEN}"
      },
      "github": {
        "owner": "my-org",
        "repo": "my-repo",
        "branch": "main",
        "token": "${GITHUB_TOKEN}",
        "snapshotPath": "Directus/snapshot/snapshot.json",
        "schemaDir": "Directus/schema"
      },
      "telegram": {
        "botToken": "${TELEGRAM_BOT_TOKEN}",
        "chatId": "YOUR_CHAT_ID"
      },
      "generateMarkdown": true
    }
  ]
}
```

Values like `${DIRECTUS_TOKEN}` are substituted from environment variables at load time.

**Multiple repositories** are supported — add more objects to the `syncs` array. Each target runs independently with its own schedule, credentials, and GitHub repo.

**Run once manually:**

```bash
# Run all configured sync targets
snap2dbml sync --config sync.json

# Run a specific target by name
snap2dbml sync --config sync.json --name my-project
```

**Daemon mode (Docker):**

Set `SYNC_CONFIG` and the server will start the scheduler automatically:

```bash
# .env
SYNC_CONFIG=/app/sync.json
DIRECTUS_TOKEN=your-directus-token
GITHUB_TOKEN=your-github-token
```

```bash
docker compose up -d
```

Each sync run produces **one commit** containing:
- Updated `snapshot.json`
- New `schema_YYYYMMDD_HHMMSS.dbml` (UTC timestamp, matching the commit message)
- New `description_YYYYMMDD_HHMMSS.md` (when `generateMarkdown: true`)
- Deletion of all previous timestamped schema files (both current and legacy `YYMMDD` formats)

**Cron expressions** support values, ranges (`1-5`), wildcards (`*`), lists (`1,3,5`), and steps (`*/15`, `8-17/2`). Scheduling is based on minute, hour, and day-of-week only; day-of-month and month fields must be `*` (anything else is rejected with an error). `7` is accepted as Sunday, and invalid values (out-of-range, non-numeric, zero steps) fail fast with a descriptive error instead of silently never firing.

## CLI Options

```
Usage: snap2dbml [options] [file]

Arguments:
  file                      Path to snapshot file (reads stdin if omitted or '-')

Options:
  -o, --output <file>       Write output to file (default: stdout)
  --stdout                  Explicitly output to stdout
  --md                      Also generate a Markdown collection description file alongside DBML
  --include-system          Include Directus system collections (directus_*)
  --include-comments        Include table/column comments from meta.note
  --max-size <mb>           Maximum input size in MB (default: 50)
  --fail-on-circular        Exit with error code 5 on circular references
  --suppress-warnings       Suppress warning messages to stderr
  -v, --verbose             Show stats/metadata as JSON after output
  -q, --quiet               Suppress all non-error output
  --version                 Show version number
  -h, --help                Show help
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Invalid input / processing error |
| 2 | File not found |
| 3 | Permission denied |
| 4 | Input file too large |
| 5 | Circular reference detected (with `--fail-on-circular`) |

## Library Options

```typescript
interface ConvertOptions {
  includeSystem?: boolean;           // Include directus_* tables (default: false)
  includeComments?: boolean;         // Include meta.note as DBML comments (default: false)
  maxSizeBytes?: number;             // Max input size (default: 50MB)
  maxDepth?: number;                 // Max JSON nesting depth (default: 100)
  suppressWarnings?: boolean;        // Suppress stderr warnings
  failOnCircularReference?: boolean; // Throw on circular references
}
```

## Example Output

Given a Directus snapshot, snap2dbml produces DBML:

```dbml
Table brokers {
  id int [pk, default: `nextval('brokers_id_seq'::regclass)`]
  currency int
  kyc_status varchar(255) [default: 'not_started']
  status varchar(255) [not null, default: 'draft']
  broker_review_id virtual [note: 'o2m → broker_reviews']
  deal_id virtual [note: 'o2m → deals']
}

Table broker_licenses {
  id int [pk, default: `nextval('broker_licenses_id_seq'::regclass)`]
  broker_id int
  license_status varchar(255) [default: 'Valid']
}

Ref: broker_licenses.broker_id > brokers.id
```

Virtual relationship aliases (O2M, M2M) are rendered as `virtual` columns with a note showing the relationship type and target collection, making them visible in tools like ChartDB.

With `--md` (or `generateMarkdown: true` in settings), snap2dbml additionally generates a Markdown file describing each collection's fields:

```markdown
### `brokers`

| Field | Type | Required | Relation | Settings |
| ----- | ---- | -------- | -------- | -------- |
| `id` | int | Yes | Primary key | Auto-generated |
| `currency` | int | No | -- | -- |
| `kyc_status` | varchar(255) | No | -- | Default: 'not_started' |
| `status` | varchar(255) | Yes | -- | Default: 'draft' |

### `broker_licenses`

| Field | Type | Required | Relation | Settings |
| ----- | ---- | -------- | -------- | -------- |
| `id` | int | Yes | Primary key | Auto-generated |
| `broker_id` | int | No | M2O to brokers | Foreign Key |
| `license_status` | varchar(255) | No | -- | Default: 'Valid' |
```

## Features

- **Directus v10.x and v11.x** snapshot support
- **All standard field types** — uuid, string, integer, float, decimal, boolean, timestamp, json, and more
- **Relationships** — M2O, O2M, M2M, and O2O with proper DBML `Ref:` syntax; O2O is detected by a unique (or primary key) constraint on the FK column
- **M2M junction tables** with metadata columns
- **Markdown output** — generates a human-readable `.md` file with per-collection field tables (Field, Type, Required, Relation, Settings) alongside DBML via `--md` or `generateMarkdown` in settings
- **HTTP backend service** — stateless REST API for use with n8n, CI/CD pipelines, or any HTTP client; deployable via Docker
- **Automated GitHub sync** — built-in `sync` command and daemon mode: fetches snapshot from Directus, converts, and pushes all changes in **a single commit** on a cron schedule; supports multiple independent repositories
- **Deterministic output** — byte-for-byte identical DBML for the same input, suitable for diffing and CI/CD
- **Circular reference detection** with optional fail-on-circular mode
- **System collection filtering** — excludes `directus_*` tables by default
- **UTF-8 support** for non-ASCII collection and field names
- **Zero runtime dependencies** beyond `commander` for CLI parsing

## Error Handling

snap2dbml provides typed error classes for programmatic use:

```typescript
import {
  InvalidSnapshotError,
  FileTooLargeError,
  CircularReferenceError,
  ValidationError,
} from 'snap2dbml';
```

Unknown field types are handled gracefully — they map to `text` with a warning, rather than failing the conversion.

## Development

```bash
# Build
npm run build

# Run tests
npm test

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage

# Fuzz testing
npm run test:fuzz

# Type checking
npm run typecheck

# Benchmarks
npm run benchmark
```

## Architecture

The conversion pipeline:

```
JSON Input → Parser → Transformer → DBML Generator → DBML Output
                                 ↘ MD Generator  → Markdown Output (optional)

HTTP POST /convert → [same pipeline] → JSON response { dbml, md }

snap2dbml sync → Directus API → [same pipeline] → GitHub API (single commit)
                                                 ↘ Telegram notification (optional)
```

1. **Parser** — validates structure, enforces size/depth limits, checks Directus version compatibility
2. **Transformer** — filters system collections, maps field types, resolves relationships, detects circular references
3. **DBML Generator** — produces sorted, deterministic DBML with proper escaping
4. **MD Generator** — produces a Markdown document with per-collection field tables (enabled via `--md`, `generateMarkdown` setting, or `generateMarkdown: true` in HTTP request)
5. **HTTP Server** — stateless Node.js HTTP server wrapping the same pipeline; authenticated via `X-API-Key` header
6. **Sync Engine** — fetches snapshot from Directus, converts, builds a single GitHub commit (Git Data API), optionally notifies via Telegram; scheduled via built-in cron or triggered manually

## Performance

| Schema Size | Target |
|-------------|--------|
| 50 collections, 500 fields | < 500ms |
| 200 collections, 2,000 fields | < 2s |
| Memory (200 collections) | < 100MB heap |
| Bundled package size | ~27KB |
