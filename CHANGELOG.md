# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [1.1.0] - 2026-03-17

### Added
- **`sync` command** (`snap2dbml sync`): Fetches a Directus snapshot, converts it to DBML/Markdown, and pushes all changes to GitHub in a single commit — no n8n or external orchestrator required.
- **Single-commit GitHub push** via the Git Data API (trees + blobs): replaces the old 5-commit n8n pattern (update snapshot.json + create .dbml + create .md + delete old .dbml + delete old .md) with one atomic commit per sync run.
- **Multi-target support**: `sync.json` contains an array of independent sync targets, each with its own Directus instance, GitHub repository, cron schedule, and optional Telegram notification.
- **Built-in cron scheduler** in server mode: set `SYNC_CONFIG=/path/to/sync.json` to auto-start the scheduler on server startup. No external cron daemon or n8n needed.
- **`SYNC_CONFIG` environment variable**: server reads this path on startup and registers scheduled jobs for all configured sync targets.
- **`--name` flag for `sync`**: run a specific named target (`snap2dbml sync --name relian`) instead of all targets.
- **Environment variable interpolation** in `sync.json`: `${VAR_NAME}` placeholders are replaced from `process.env` at load time, keeping secrets out of config files.
- **Fetch timeouts** (30 s, `AbortSignal`): all outbound HTTP calls (Directus, GitHub API, Telegram) now abort after 30 seconds instead of hanging indefinitely.
- **Config validation**: `loadSyncConfig` validates all required fields per sync target and rejects duplicate names with clear error messages.
- **Cron step notation** (`*/5`, `1-30/2`): the built-in cron parser now supports step expressions in addition to values, ranges, lists, and wildcards.
- `src/sync-config.ts`: types and config loading for `sync.json`.
- `src/github-client.ts`: GitHub Git Data API client — `listDirectory`, `createSingleCommit`.
- `src/syncer.ts`: orchestrates one sync cycle (fetch → convert → commit → notify).
- `src/scheduler.ts`: in-process cron scheduler (pure `setTimeout`, no new runtime deps).
- `src/sync.ts`: barrel export for all sync modules.
- `sync.example.json`: example configuration template.

### Changed
- `src/server.ts`: on startup, checks `SYNC_CONFIG` env var and starts the scheduler if set; calls `scheduler.stop()` on `server.close()`.
- `tsup.config.ts`: added `src/sync.ts` as a third build entry point (`dist/sync.js`).
- `bin/snap2dbml.js`: added `sync` subcommand (imports from `dist/sync.js`).

### Fixed (code review)
- `runAll()` in `SyncScheduler` now throws if any target failed, so the `sync` CLI exits with code `1` on partial failure (previously always exited `0`).
- Telegram notifications now log an error on non-2xx HTTP responses instead of silently swallowing them.
- Scheduler is stopped via `server.once('close', ...)` preventing timer leaks when the HTTP server is closed without process exit.

## [1.0.0] - 2026-03-16

### Fixed
- **Data-loss bug**: `cleanOutput` now only removes timestamped managed files (`schema_YYYYMMDD_HHMMSS.dbml` / `description_YYYYMMDD_HHMMSS.md`) from the configured output folder. Explicit `-o/--output` paths are never cleaned automatically, preventing unrelated files from being deleted.
- **O2O relationships**: One-to-one relations now correctly emit `-` in DBML instead of `>`. Detection is based on Directus `meta.one_field` presence.
- **`maxDepth` option**: Previously documented but silently ignored. Now enforced via iterative DFS in the parser with a clear error on violation.
- **`--max-size` validation**: Invalid non-numeric values no longer exit with code 0. A `ValidationError` is thrown with a descriptive message.
- **Double parse/transform**: When both DBML and Markdown output are requested (e.g. via the HTTP server), the snapshot is now parsed and transformed only once via the shared `conversion.ts` pipeline.
- **Server side effects**: `src/server.ts` no longer executes `listen()` at import time. The server is now created via `createAppServer()` factory, making it properly testable.
- **Markdown table escaping**: Pipe characters (`|`), newlines, and carriage returns in field/table names are now escaped in Markdown output to prevent broken tables.
- **Markdown O2O label**: Relation column in Markdown output now correctly shows `O2O to <table>` instead of `M2O to <table>` for one-to-one relations.
- **Library version**: Version string is now read from `package.json` at runtime via `src/version.ts` instead of being hardcoded.
- **CI test gap**: GitHub Actions workflow now runs `npm ci`, `npm run build`, `npm run typecheck`, and `npm test` before building and publishing the Docker image.
- **CLI test temp directory**: `mkdirSync` with `recursive: true` is now called before `mkdtempSync` in `cli.test.ts` to prevent `ENOENT` on CI when the `temp/` directory does not exist.

### Added
- `src/conversion.ts`: Shared conversion pipeline (`buildConversionArtifacts`, `buildConversionArtifactsFromParsedSnapshot`) used by the library API, CLI, and HTTP server.
- `src/version.ts`: Reads the library version from `package.json` at runtime.
- Real HTTP integration tests in `tests/integration/api.test.ts` covering `/health`, authentication, body size limits, malformed JSON, and conversion errors.
- Regression tests for `maxDepth` enforcement (`tests/unit/parser.test.ts`), O2O relation emission (`tests/unit/transformer.test.ts`), and Markdown escaping (`tests/unit/md-generator.test.ts`).
- Additional CLI regression tests for `cleanOutput` scoping and `--max-size` validation (`tests/integration/cli.test.ts`).

---

## [0.4.0] - 2026-02-26

### Fixed
- Resolved conflict between group names and collection field names in transformer output.

### Changed
- Updated GitHub Actions Docker publish workflow.

---

## [0.3.0] - 2026-02-23

### Added
- HTTP server (`src/server.ts`) with `/health` and `/convert` endpoints, API key authentication, and 50 MB body limit.
- Dockerfile, `.dockerignore`, `docker-compose.yml`, and `docker-compose.dev.yml` for containerised deployment.
- GitHub Actions workflow (`.github/workflows/docker-publish.yml`) to build and publish Docker image to GitHub Container Registry on push to `prod`.
- `.env.example` documenting `PORT` and `API_KEY` environment variables.

### Added (earlier in 0.3.x)
- Markdown collection description generation (`src/md-generator.ts`) via `--md` CLI flag or `generateMarkdown` setting.
- `convertSnapshotToMarkdown` library function.

---

## [0.2.0] - 2026-02-24

### Changed
- Revised README title and project description for clarity.
- Clarified Node.js version requirement (≥18).
- Generalised DBML tool references in README.

---

## [0.1.0] - 2026-02-16

### Added
- Initial release.
- CLI (`bin/snap2dbml.js`) with support for file input, `--stdout`, `--output`, `--max-size`, `--include-system`, `--no-comments`, `--suppress-warnings`, `--quiet`, and `--version` flags.
- Core library: `parseSnapshot`, `parseSnapshotString`, `convertSnapshot`, `convertSnapshotString`, `convertSnapshotWithStats`.
- Parser with JSON size limit enforcement (`src/parser.ts`).
- Schema validator for Directus snapshot structure (`src/validator.ts`).
- Transformer producing typed `SchemaModel` from a validated snapshot, including M2O/M2M relationship resolution and circular reference detection (`src/transformer.ts`).
- DBML generator (`src/generator.ts`) with deterministic, alphabetically sorted output.
- PostgreSQL type mapping (`src/type-map.ts`).
- Typed error hierarchy: `Snap2DBMLError`, `InvalidSnapshotError`, `FileTooLargeError`, `ValidationError` (`src/errors.ts`).
- `settings.json` support for `inputFolder`, `outputFolder`, `cleanOutput`, and `generateMarkdown`.
- Timestamped output file naming (`schema_YYYYMMDD_HHMMSS.dbml`).
- Test suite: unit, integration (CLI), and fuzz tests with fixture snapshots covering basic schemas, all field types, UTF-8 names, system tables, M2O/M2M relationships, circular references, and malformed inputs.
- Benchmarking script (`benchmarks/run.js`).
