# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- **`docker-compose.stage.yml`**: staging container that runs alongside production on the same host (`:stage` image, port 3001, separate compose project name and `.env.stage`), for validating changes without touching the prod instance.

### Changed
- **Production compose pinned to an explicit image tag**: `docker-compose.yml` now uses `:prod` by default (`IMAGE_TAG` env override for immutable `sha-*` pinning) instead of `:latest`, which CI never actually published — `docker compose pull` could silently resolve to a stale or wrong image.
- **CI image tags documented and made explicit**: `latest=false` in the publish workflow; every push to `stage`/`prod` produces the branch tag plus an immutable `sha-<short>` tag.

### Fixed
- **O2O misclassification**: relations were marked one-to-one (`-`) whenever `meta.one_field` was set, but `one_field` only indicates a reverse O2M alias field — 23 of 107 ordinary M2O relations in a real snapshot were rendered as O2O. Detection is now based on a unique (or primary key) constraint on the FK column (`schema.is_unique` / `is_primary_key`).
- **Default value escaping**: string defaults containing single quotes, backslashes, or newlines are now escaped before embedding in DBML; object defaults are serialized as JSON instead of `[object Object]`.
- **Virtual field notes**: alias field labels in `[note: '...']` are now escaped, so quotes in field/collection names no longer break the DBML output.
- **Cron parser hardening** (`scheduler.ts`): `*/0` no longer causes an infinite loop; `7` is accepted as Sunday (standard cron); non-numeric, out-of-range, and inverted values now throw a clear error instead of silently never matching; non-`*` day-of-month/month fields now throw instead of being silently ignored (previously `0 0 1 * *` ran daily).
- **Alias/column name collisions**: an alias virtual field whose name matches a real column is dropped with a `DUPLICATE_VIRTUAL_FIELD` warning instead of producing duplicate column lines in the table block.
- **Server error handling**: unexpected internal errors now return `500` with a generic message (and are logged) instead of leaking `err.message` as `422`; only `Snap2DBMLError`s map to `422`.
- **Server hardening**: API key comparison uses `crypto.timingSafeEqual`; invalid `PORT` env values throw at startup instead of `listen(NaN)` binding a random port.
- **Sync timestamp consistency**: sync filenames now use the same `schema_YYYYMMDD_HHMMSS` format as the CLI (was 2-digit year) and UTC (matching the commit message); cleanup matches both old and new formats.
- **Sync same-second rerun**: paths about to be written are excluded from the deletion list, preventing duplicate-path errors from the GitHub tree API.

### Changed
- **MULTIPLE_PRIMARY_KEYS warning** is now actually emitted when a collection has more than one primary key column (the code existed but was never used).
- **CLI single-pass conversion**: `--md` no longer parses and transforms the snapshot twice; the CLI uses the shared `buildConversionArtifacts` pipeline (now exported from the library).
- **GitHub blobs** are created in parallel during sync commits.
- **Circular reference detection** uses an iterative DFS, so very long reference chains cannot overflow the call stack.
- **Size check** in `parseSnapshotString` uses `Buffer.byteLength` instead of copying the input via `TextEncoder`.

### Removed
- Dead code: unused `UnsupportedFieldError` class and `ERROR_CODES.UNSUPPORTED_VERSION` constant.

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
