# snap2dbml

Convert [Directus](https://directus.io/) JSON schema snapshots into [DBML](https://dbml.dbdiagram.io/) for database visualization, documentation, and version-controlled schema history.

Directus stores schema snapshots in a proprietary JSON format. snap2dbml turns them into deterministic, diffable DBML and optional Markdown documentation without manual schema maintenance.

Requires **Node.js 18.0.0** or newer.

## CLI

### Installation

```bash
npm install snap2dbml
```

To make `snap2dbml` available globally from a cloned repository:

```bash
npm link
```

### Basic usage

```bash
# Convert using settings.json
snap2dbml

# Convert a specific snapshot
snap2dbml snapshot.json

# Generate DBML and Markdown documentation
snap2dbml snapshot.json --md

# Write DBML to an explicit path
snap2dbml snapshot.json -o schema.dbml

# Read a snapshot from stdin
cat snapshot.json | snap2dbml
```

### CLI settings

Copy the example and adjust the paths:

```bash
cp settings.example.json settings.json
```

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
| `inputFolder` | Folder containing the Directus snapshot JSON file. Used when no file argument is passed. |
| `outputFolder` | Folder where generated files are written. |
| `cleanOutput` | Deletes previous timestamped `schema_*.dbml` outputs and matching `description_*.md` files from the managed output folder. Explicit `--output` paths are never cleaned automatically. |
| `generateMarkdown` | Generates a Markdown collection description alongside DBML. |

Paths may be relative to the working directory or absolute.

### Automated GitHub sync

The CLI can fetch snapshots from Directus and commit the converted files to GitHub without n8n or an external orchestrator. Every run creates at most one GitHub commit.

Create the configuration:

```bash
cp sync.example.json sync.json
```

```json
{
  "syncs": [
    {
      "name": "my-project",
      "schedule": "0 0 * * 1-5",
      "timezone": "Europe/Podgorica",
      "directus": {
        "snapshotUrl": "https://cms.example.com/schema/snapshot?export=json",
        "bearerToken": "${DIRECTUS_TOKEN}"
      },
      "github": {
        "repository": "my-org/my-repo",
        "token": "${GITHUB_TOKEN}",
        "snapshotPath": "Directus/snapshot/snapshot.json",
        "schemaDir": "Directus/schema"
      },
      "telegram": {
        "botToken": "${TELEGRAM_BOT_TOKEN}",
        "chatId": "YOUR_CHAT_ID",
        "notifyOn": "always"
      },
      "generateMarkdown": true
    }
  ]
}
```

`github.repository` accepts the preferred `owner/repo` form or a full `https://github.com/owner/repo` URL. It does not encode a branch. `github.branch` is optional and defaults to `main`:

```json
{
  "repository": "my-org/my-repo",
  "branch": "schema-docs"
}
```

The legacy `owner` and `repo` fields remain supported for existing configurations, but they cannot be combined with `repository` in the same target. Values such as `${DIRECTUS_TOKEN}` are substituted from environment variables when the configuration is loaded.

Add more objects to `syncs` to manage multiple repositories. Each target has an independent schedule, credentials, destination, and conversion settings.

`telegram.notifyOn` controls which completed sync outcomes produce a Telegram message:

| Value | Behavior |
|-------|----------|
| `success` | Notify after every successfully completed sync, including runs where no GitHub commit was needed. This is the default. |
| `failure` | Notify only when the sync fails. |
| `always` | Notify after both successful and failed syncs. |

Telegram delivery is non-fatal: a delivery error is logged without changing the sync result. Failure messages contain a concise error reason and never include configured credentials or snapshot payloads.

Run configured targets manually:

```bash
# Run all targets
snap2dbml sync --config sync.json

# Run one target
snap2dbml sync --config sync.json --name my-project
```

Each successful sync commit contains:

- the updated `snapshot.json`;
- a new `schema_YYYYMMDD_HHMMSS.dbml` using a UTC timestamp;
- a matching `description_YYYYMMDD_HHMMSS.md` when Markdown generation is enabled;
- deletion of previous `.dbml` and `.md` artifacts from the managed `schemaDir`.

The directory listing and commit use the same branch revision. If another scheduler updates the branch concurrently, sync reads the new HEAD and retries. Identical Git trees are not committed. With the default `telegram.notifyOn: "success"`, both committed and no-change runs produce a success notification.

Scheduling uses [croner](https://github.com/hexagon/croner). Cron expressions support values, ranges (`1-5`), wildcards (`*`), lists (`1,3,5`), steps (`*/15`, `8-17/2`), day and month names (`MON-FRI`, `JAN`), and the `L` (last), `W` (nearest weekday), and `#` (nth weekday) modifiers. All five fields are evaluated; `7` is accepted as Sunday. An optional `timezone` per target pins the schedule to an IANA timezone (e.g. `"timezone": "Europe/Podgorica"`); without it, schedules run in server-local time. Invalid schedules and timezones are rejected when the configuration is loaded.

### CLI options

```text
Usage: snap2dbml [options] [file]

Arguments:
  file                      Path to snapshot file (reads stdin if omitted or '-')

Options:
  -o, --output <file>       Write output to file (default: stdout)
  --stdout                  Explicitly output to stdout
  --md                      Also generate a Markdown collection description file
  --include-system          Include Directus system collections (directus_*)
  --include-comments        Include table/column comments from meta.note
  --max-size <mb>           Maximum input size in MB (default: 50)
  --fail-on-circular        Exit with code 5 on circular references
  --suppress-warnings       Suppress warning messages to stderr
  -v, --verbose             Show stats and metadata as JSON after output
  -q, --quiet               Suppress all non-error output
  --version                 Show version number
  -h, --help                Show help
```

### CLI exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Invalid input or processing error |
| 2 | File not found |
| 3 | Permission denied |
| 4 | Input file too large |
| 5 | Circular reference detected with `--fail-on-circular` |

## HTTP API

snap2dbml includes a stateless HTTP service for n8n, CI/CD pipelines, and other HTTP clients. It uses the same conversion pipeline as the CLI and library.

### Running without Docker

```bash
npm install
npm run build
API_KEY=your-secret npm start
```

The server listens on port `3000` by default.

### Authentication

Set `API_KEY` to require the same value in the `X-API-Key` request header. Leaving `API_KEY` empty disables authentication and is not recommended outside local development.

### Endpoints

`GET /health` requires no authentication and returns:

```json
{"status":"ok"}
```

`GET /status` requires the API key and reports service and sync activity without host access:

```json
{
  "status": "ok",
  "version": "1.0.0",
  "uptimeSeconds": 86400,
  "scheduler": true,
  "targets": [
    {
      "name": "my-project",
      "running": false,
      "lastRunAt": "2026-07-30T00:00:01.000Z",
      "lastOutcome": "success",
      "lastCommitted": true,
      "nextRunAt": "2026-07-31T00:00:00.000Z"
    }
  ],
  "recentLogs": [
    {"time": "2026-07-30T00:00:01.000Z", "level": "info", "scope": "sync:my-project", "msg": "Done", "committed": true}
  ]
}
```

`targets` reflects sync activity since the last restart; `lastError` is present after a failed run. `recentLogs` holds the last 200 log records.

`POST /convert` converts a Directus snapshot:

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

### HTTP status codes

| Status | Meaning |
|--------|---------|
| 200 | Conversion succeeded |
| 400 | Invalid JSON body or missing `snapshot` field |
| 401 | Missing or incorrect `X-API-Key` |
| 404 | Unknown method or path |
| 413 | Request body exceeds 50 MB |
| 422 | Snapshot validation or conversion failed |
| 500 | Internal error; details are logged server-side |

### Logging

The service writes structured JSON logs to stdout, one object per line: `{"time","level","scope","msg",...}`. Requests are logged with method, path (query string stripped), status, and duration; `/health` requests log at `debug` level so container healthchecks stay out of the default stream. View logs with `docker logs` (or `docker compose logs`); the Compose services cap Docker's log storage at 3 rotated files of 10 MB each. The one-shot `snap2dbml sync` CLI command logs human-readable text to stderr instead.

### HTTP environment variables

| Variable | Description |
|----------|-------------|
| `PORT` | Listening port. Default: `3000`. |
| `API_KEY` | Secret expected in `X-API-Key`. Empty disables authentication. |
| `LOG_LEVEL` | Minimum log level: `debug`, `info`, `warn`, or `error`. Default: `info`. |
| `SYNC_CONFIG` | Optional path to `sync.json`; starts the built-in scheduler with the HTTP server. |

## Docker

Docker uses one `docker/docker-compose.yml` and one shared `docker/.env`. The Compose file defines `prod` and `stage` services with different image tags but the same runtime configuration and host port. They are replacement instances: only one may run at a time.

### Local Docker build

Build the current checkout and run it on port `3001` without starting the configured scheduler:

```bash
cp docker/.env.example docker/.env
# Set API_KEY in docker/.env
docker build -t snap2dbml:local .
docker run --rm --env-file docker/.env -e SYNC_CONFIG= -p 3001:3000 snap2dbml:local
curl http://localhost:3001/health
```

This validates the local Docker build. It does not mount source files or provide hot reload.

### Production deployment

Create the shared environment file, then start the production service on port `3000`:

```bash
cp docker/.env.example docker/.env
# Set API_KEY, GHCR_OWNER, and any sync credentials in docker/.env
cd docker
docker compose pull prod
docker compose up -d prod
curl http://localhost:3000/health
```

GitHub Actions publishes images for pushes to the `stage` and `prod` branches. Each build receives the branch tag and an immutable `sha-<short>` tag. No `latest` tag is published. Set `PROD_IMAGE_TAG=sha-...` or `STAGE_IMAGE_TAG=sha-...` in `docker/.env` to pin a service to an immutable build.

### Testing stage in place of production

The two services use the same host port, API key, sync configuration, and credentials. Stop production before starting stage so the port and scheduler have a single owner:

```bash
cd docker
docker compose --profile stage pull stage
docker compose stop prod
docker compose --profile stage up -d stage
curl http://localhost:3000/health
```

After the tested commit is published under the `prod` tag, pull it before stopping stage, then switch back:

```bash
docker compose pull prod
docker compose --profile stage stop stage
docker compose up -d prod
```

If stage fails, restore the stopped production container without recreating it:

```bash
docker compose --profile stage stop stage
docker compose start prod
```

`docker compose --profile stage ps -a` shows both containers and which one is active. The `stage` profile prevents an untargeted `docker compose up` from attempting to bind both services to port `3000`.

### Docker environment variables

| Variable | Description |
|----------|-------------|
| `GHCR_OWNER` | GitHub account or organization that owns the container image. |
| `PROD_IMAGE_TAG` | Production image tag. Default: `prod`; may be an immutable `sha-*` tag. |
| `STAGE_IMAGE_TAG` | Stage image tag. Default: `stage`; may be an immutable `sha-*` tag. |
| `PORT` | Internal HTTP listening port. Compose keeps it at `3000`. |
| `API_KEY` | Shared HTTP API key used by the active service. |
| `SYNC_CONFIG` | Path to the sync configuration inside the container. |

### Scheduled sync in Docker

Set the scheduler variables in the environment file:

```bash
SYNC_CONFIG=/app/sync.json
DIRECTUS_TOKEN=your-directus-token
GITHUB_TOKEN=your-github-token
```

Place the shared configuration at `docker/sync.json` and enable the volume in `docker/docker-compose.yml`:

```yaml
volumes:
  - ./sync.json:/app/sync.json:ro
```

Both services inherit this mount. Because they are never run simultaneously, production and stage exercise the same scheduler configuration without duplicate sync runs.

## Library API

### Conversion

```typescript
import {
  buildConversionArtifacts,
  convertSnapshot,
  convertSnapshotString,
  convertSnapshotToMarkdown,
  convertSnapshotWithStats,
} from 'snap2dbml';

const dbmlFromObject = convertSnapshot(snapshotObject);
const dbmlFromString = convertSnapshotString(snapshotJson);

const result = convertSnapshotWithStats(snapshotObject, {
  includeSystem: false,
  includeComments: true,
});

const markdown = convertSnapshotToMarkdown(snapshotObject);

const artifacts = buildConversionArtifacts(
  snapshotObject,
  { includeComments: true },
  true,
);
// artifacts.dbml
// artifacts.markdown
// artifacts.warnings
// artifacts.stats
// artifacts.metadata
```

### Conversion options

```typescript
interface ConvertOptions {
  includeSystem?: boolean;           // Include directus_* tables (default: false)
  includeComments?: boolean;         // Include meta.note as DBML comments (default: false)
  maxSizeBytes?: number;             // Maximum input size (default: 50 MB)
  maxDepth?: number;                 // Maximum JSON nesting depth (default: 100)
  suppressWarnings?: boolean;        // Suppress stderr warnings
  failOnCircularReference?: boolean; // Throw on circular references
}
```

### Error handling

```typescript
import {
  CircularReferenceError,
  FileTooLargeError,
  InvalidSnapshotError,
  ValidationError,
} from 'snap2dbml';
```

Unknown field types map to `text` with a warning instead of aborting conversion.

## Output examples

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

Virtual O2M and M2M aliases are rendered as `virtual` columns with notes, making them visible in tools such as ChartDB.

Markdown generation produces collection field tables:

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

- Directus v10.x+ snapshot support
- PostgreSQL and Directus field type mapping
- M2O, O2M, M2M, and constraint-based O2O relationship detection
- M2M junction tables with metadata columns
- Optional Markdown collection documentation
- Deterministic output suitable for Git diffs and CI/CD
- Automated single-commit GitHub sync with optional Telegram notifications
- Circular-reference detection and configurable failure behavior
- Directus system collection filtering
- UTF-8 collection and field names
- Stateless authenticated HTTP API
- In-place Docker switching between stage and production images

## Development

```bash
npm run build          # Build
npm test               # Run tests
npm run test:watch     # Watch mode
npm run test:coverage  # Coverage
npm run test:fuzz      # Fuzz tests
npm run typecheck      # TypeScript checks
npm run benchmark      # Benchmarks
```

## Architecture

```text
JSON Input → Parser → Transformer → DBML Generator → DBML Output
                                 ↘ MD Generator  → Markdown Output (optional)

HTTP POST /convert → same pipeline → JSON response { dbml, md }

snap2dbml sync → Directus API → same pipeline → GitHub API (single commit)
                                                 ↘ Telegram notification (optional)
```

1. **Parser** validates structure, size, depth, and supported Directus versions.
2. **Transformer** filters collections, maps types, resolves relationships, and detects circular references.
3. **DBML Generator** creates sorted deterministic DBML with escaping.
4. **MD Generator** creates per-collection Markdown field tables.
5. **HTTP Server** exposes the conversion pipeline through an authenticated REST API.
6. **Sync Engine** fetches Directus snapshots and atomically updates GitHub on demand or on a schedule.

## Performance

| Schema size | Target |
|-------------|--------|
| 50 collections, 500 fields | < 500 ms |
| 200 collections, 2,000 fields | < 2 s |
| Memory with 200 collections | < 100 MB heap |
| Bundled package size | ~27 KB |
