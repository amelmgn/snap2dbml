## 3.0.0 [2026-07-31]

Expanded the existing per-target `timezone` setting to control cron evaluation, generated DBML/Markdown filenames, matching GitHub commit messages, and Telegram's `{{time}}` placeholder. The setting accepts a validated IANA timezone. Its default changed from server-local time for cron to `UTC` for every sync timestamp and schedule; deployments that relied on the host timezone must now set `timezone` explicitly.

Added configurable Telegram notification outcomes. `telegram.notifyOn` accepts `success`, `failure`, or `always` and defaults to `success`. Successful no-change runs count as success, failure notifications preserve the original sync error, and Telegram delivery remains non-fatal.

Added per-outcome Telegram message templates for runs that create a commit, complete without changes, or fail. `telegram.messages.success`, `noChanges`, and `failure` support `{{name}}`, `{{time}}`, and `{{error}}` placeholders, while omitted templates retain the previous English messages.

Consolidated Docker deployment into `docker/docker-compose.yml` and one shared `docker/.env`. Production and profile-gated stage services use separate image tags and containers but intentionally share port `3000`, credentials, and the optional sync mount, making them mutually exclusive replacement instances. CI publishes `stage`, `prod`, and immutable `sha-*` tags without publishing `latest`; the documented switch and rollback flows preserve the stopped replacement container.

Aligned package metadata and repository guidance with the current deployment layout, added project instructions for coding agents, and moved the Markdown template under `docs/`.

Updated files: `package.json`, `package-lock.json`, `src/sync-config.ts`, `src/syncer.ts`, `src/sync.ts`, `src/scheduler.ts`, `src/telegram.ts`, `sync.example.json`, `docker/docker-compose.yml`, `docker/.env.example`, removed root and environment-specific Compose assets, `.github/workflows/docker-publish.yml`, `.gitignore`, `README.md`, `docs/tech-spec.md`, `docs/md-template.md`, `AGENTS.md`, `CLAUDE.md`, `tests/unit/sync-config.test.ts`, `tests/unit/syncer.test.ts`, `tests/unit/scheduler.test.ts`, `tests/unit/telegram.test.ts`.

## 2.0.0 [2026-07-30]

Added structured logging and a status endpoint to the service. All server and sync output is now emitted as JSON lines on stdout (`{"time","level","scope","msg",...}`) through a new zero-dependency logger (`src/logger.ts`) with `debug`/`info`/`warn`/`error` levels controlled by `LOG_LEVEL` (default `info`). HTTP requests are logged with method, path (query string stripped), status, and duration; `/health` logs at `debug` so container healthchecks stay out of the default stream. Errors carry serialized `message`/`stack` fields. The one-shot `snap2dbml sync` CLI command logs human-readable text to stderr instead of JSON.

Capped Docker log storage for the production and staging containers at 3 rotated files of 10 MB each (`logging` options in `docker-compose.yml` and `docker-compose.stage.yml`), so the json-file driver cannot grow unbounded on long-running hosts.

Added `GET /status` (API-key protected). It reports service version, uptime, whether the scheduler is active, per-target sync state (last run, outcome, whether a commit was produced, last error, next run) tracked by a new in-memory `StatusRegistry` (`src/status.ts`), and a ring buffer of the last 200 log records. `runSync` now returns `{ committed }` so callers and the registry see the run outcome.

Updated files: `src/logger.ts`, `src/status.ts`, `src/server.ts`, `src/scheduler.ts`, `src/syncer.ts`, `src/sync.ts`, `bin/snap2dbml.js`, `.env.example`, `README.md`, `tests/unit/logger.test.ts`, `tests/unit/status.test.ts`, `tests/unit/scheduler.test.ts`, `tests/unit/syncer.test.ts`, `tests/integration/api.test.ts`, `tests/helpers/capture-logger.ts`.

Replaced the hand-written cron parser with [croner](https://github.com/hexagon/croner) (zero-dependency, MIT). The scheduler now supports the full cron syntax: all five fields including day-of-month and month, day and month names (`MON-FRI`, `JAN`), and the `L`, `W`, and `#` modifiers. Each sync target accepts an optional `timezone` (IANA name, e.g. `Europe/Podgorica`) so schedules no longer depend on server-local time. Invalid schedules and timezones are now rejected when `sync.json` is loaded instead of being logged and skipped at runtime. Scheduled runs use croner's overrun protection, so a slow sync cannot overlap with its next firing. `scheduler.ts` shrank from 183 to about 110 lines; the internal `parseField`/`getNextRunMs` helpers were removed in favor of an exported `getNextRun(expression, timezone?)`.

Updated files: `src/scheduler.ts`, `src/sync-config.ts`, `package.json`, `sync.example.json`, `README.md`, `tests/unit/scheduler.test.ts`, `tests/unit/sync-config.test.ts`.

Made automated GitHub sync concurrency-safe. Previously, a sync listed the existing schema files before resolving the branch HEAD used as the parent commit. If another scheduler updated the same branch in between those operations, the later run could build on the new commit without knowing about its DBML and Markdown files, leaving both the old and new artifact sets in `schemaDir`. Directory listing and commit creation are now pinned to the same HEAD. A non-fast-forward branch update is retried from the latest HEAD, so the retry sees and removes files created by a competing run.

Changed cleanup semantics for the managed schema directory. Every previous `.dbml` and `.md` file in `schemaDir` is now removed before the latest set is committed, including artifacts whose names do not match the current `YYYYMMDD_HHMMSS` or legacy `YYMMDD_HHMMSS` naming patterns. Other file types in the directory are preserved. Paths written by the current run are excluded from deletion, so two runs within the same second cannot submit duplicate tree entries.

Prevented zero-file commits. After GitHub creates the candidate tree, sync compares its SHA with the parent tree SHA and skips commit creation when they are identical. Telegram notifications are sent only after a real branch update. GitHub API errors now carry structured status and path data, allowing sync to distinguish a concurrent ref update from unrelated API failures.

Standardized sync timestamps. Generated files now use `schema_YYYYMMDD_HHMMSS.dbml` and `description_YYYYMMDD_HHMMSS.md` with an eight-digit UTC date, matching the UTC timestamp in the commit message. Cleanup remains compatible with files created using the earlier six-digit date format.

Added regression coverage for concurrent branch updates, complete DBML/Markdown cleanup, preservation of unrelated files, suppression of commits whose resulting Git tree is unchanged, and compact GitHub repository parsing. The full suite now contains 207 passing tests.

Separated staging and production deployment. Added `docker-compose.stage.yml` for a stage container on port 3001 with its own Compose project and `.env.stage`. Production now pulls the explicit `:prod` image tag by default and can be pinned to an immutable `sha-*` tag through `IMAGE_TAG`; staging uses `:stage` or `STAGE_IMAGE_TAG`. CI explicitly disables `latest` and publishes a branch tag plus an immutable SHA tag on each build.

Simplified GitHub sync configuration and documented the migration. The preferred `github.repository` field combines the repository owner and name in `owner/repo` form and also accepts a full `https://github.com/owner/repo` URL. Repository identifiers do not encode a branch, so `branch` remains a separate optional field and defaults to `main`. Existing configs that use separate `owner` and `repo` fields remain supported, while mixing both formats is rejected as ambiguous.

Restructured `README.md` by usage surface. CLI installation, settings, sync configuration, commands, options, and exit codes now live under one CLI section. The REST contract and native server startup are isolated under HTTP API, while local image builds, production, staging, container variables, and scheduled sync mounts are grouped under Docker. The library API remains a separate section.

Corrected relationship detection. `meta.one_field` identifies the reverse alias of an ordinary M2O relation and is no longer treated as proof of O2O. A relation is emitted as one-to-one only when its foreign-key column has a unique or primary-key constraint. This corrected 23 of 107 relations in the real snapshot used during validation. Alias virtual fields that collide with real columns are now dropped with a `DUPLICATE_VIRTUAL_FIELD` warning.

Hardened DBML generation and validation. String defaults now escape quotes, backslashes, and newlines; object defaults are serialized as JSON; virtual-field notes escape labels safely. Multiple primary keys now emit the existing `MULTIPLE_PRIMARY_KEYS` warning. Circular-reference detection uses iterative DFS, and input byte-size checks use `Buffer.byteLength`.

Hardened the scheduler and HTTP server. Cron rejects zero steps, inverted or out-of-range values, and unsupported day-of-month/month expressions; `7` is accepted as Sunday. Unexpected conversion failures now return a generic HTTP 500 while known `Snap2DBMLError` instances remain HTTP 422. API-key comparison uses `crypto.timingSafeEqual`, and invalid `PORT` values fail during startup.

Reduced duplicate work in conversion and sync. CLI Markdown generation now uses the shared single-pass artifact pipeline, and GitHub blobs are created in parallel. Removed the unused `UnsupportedFieldError` class and `ERROR_CODES.UNSUPPORTED_VERSION` constant.

Updated files: `src/sync-config.ts`, `src/syncer.ts`, `src/github-client.ts`, `src/scheduler.ts`, `src/server.ts`, `src/transformer.ts`, `src/parser.ts`, `src/generator.ts`, `src/conversion.ts`, `src/errors.ts`, `src/type-map.ts`, `bin/snap2dbml.js`, `sync.example.json`, `docker-compose.yml`, `docker-compose.stage.yml`, `.github/workflows/docker-publish.yml`, `README.md`, `tests/unit/sync-config.test.ts`, `tests/unit/syncer.test.ts`, `tests/unit/github-client.test.ts`, and related regression tests.

## 1.1.0 [2026-03-17]

Added the automated GitHub sync engine. The new `snap2dbml sync` command fetches a Directus snapshot, converts it to DBML and optional Markdown, and writes the snapshot plus all generated artifacts to GitHub in one commit through the Git Data API. This replaced the earlier five-commit n8n flow that updated the snapshot, created two output files, and deleted two old files separately.

Added multi-target configuration through `sync.json`. Each target has its own name, cron schedule, Directus endpoint and token, GitHub repository, branch and output paths, optional conversion settings, and optional Telegram destination. `${ENV_VAR}` placeholders are resolved at load time, required fields are validated, and duplicate target names are rejected. `snap2dbml sync --name <target>` runs one target; omitting `--name` runs all configured targets.

Added the built-in scheduler used by server mode when `SYNC_CONFIG` is set. It supports values, ranges, lists, wildcards, and step expressions such as `*/5`. Scheduled targets run independently, timers are stopped when the server closes, and a failed target causes the one-shot CLI command to exit unsuccessfully instead of reporting a partial run as successful.

Added 30-second timeouts to Directus, GitHub, and Telegram requests. Telegram delivery failures are logged for both transport errors and non-2xx responses without undoing an already successful GitHub commit.

Updated files: `src/sync-config.ts`, `src/github-client.ts`, `src/syncer.ts`, `src/scheduler.ts`, `src/sync.ts`, `src/server.ts`, `bin/snap2dbml.js`, `tsup.config.ts`, `sync.example.json`, `.env.example`, and `README.md`.

## 1.0.0 [2026-03-16]

Stabilized the first production release. Managed output cleanup now removes only timestamped `schema_YYYYMMDD_HHMMSS.dbml` and matching Markdown files from the configured output folder; explicit `--output` paths and unrelated files are never deleted automatically. The CLI creates its temporary test directory before calling `mkdtempSync`, preventing CI-only `ENOENT` failures.

Added the shared `buildConversionArtifacts` pipeline used by the library, CLI, and HTTP API. DBML and Markdown can now be generated from one parse/transform pass. Package version metadata is read from `package.json` through `src/version.ts` instead of being duplicated in source.

Implemented and tested `maxDepth` enforcement with iterative traversal. Invalid `--max-size` values now fail with a `ValidationError`. Markdown generation escapes pipes and line breaks in table cells and labels one-to-one relations correctly.

Removed server startup side effects from module import. `createAppServer()` now constructs a testable server without listening, while `startServer()` performs explicit startup. Unexpected server behavior, authentication, request-size limits, malformed JSON, conversion errors, and health checks gained HTTP integration coverage. CI now installs dependencies, builds, typechecks, and runs the full test suite before publishing a Docker image.

Updated files: `src/conversion.ts`, `src/version.ts`, `src/parser.ts`, `src/transformer.ts`, `src/md-generator.ts`, `src/server.ts`, `bin/snap2dbml.js`, `.github/workflows/docker-publish.yml`, `tests/integration/api.test.ts`, `tests/integration/cli.test.ts`, and related unit tests.

## 0.4.0 [2026-02-26]

Resolved a transformer collision between collection group names and collection field names. Updated the GitHub Actions Docker publishing workflow to match the release process.

Updated files: `src/transformer.ts`, `.github/workflows/docker-publish.yml`.

## 0.3.0 [2026-02-23]

Added the stateless HTTP service with `/health` and `/convert` endpoints, optional API-key authentication, and a 50 MB request-body limit. Added Dockerfile, development and production Compose configurations, environment examples, and a GitHub Actions workflow that builds and publishes the container image to GitHub Container Registry on pushes to `prod`.

Added Markdown collection documentation. The CLI accepts `--md`, settings support `generateMarkdown`, and the library exports `convertSnapshotToMarkdown`. Generated documents describe each collection and its fields, types, required state, relations, and settings.

Updated files: `src/server.ts`, `src/md-generator.ts`, `src/index.ts`, `bin/snap2dbml.js`, `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `docker-compose.dev.yml`, `.env.example`, `.github/workflows/docker-publish.yml`, and `README.md`.

## 0.2.0 [2026-02-24]

Revised the project title and description, clarified the Node.js 18 or newer requirement, and generalized references to DBML-compatible visualization tools.

Updated files: `README.md`, `package.json`.

## 0.1.0 [2026-02-16]

Initial release. Added the `snap2dbml` CLI with file and stdin input, stdout and explicit output modes, size limits, system-table inclusion, comment controls, warning suppression, quiet mode, settings-file support, and timestamped `schema_YYYYMMDD_HHMMSS.dbml` output.

Added the core library API: `parseSnapshot`, `parseSnapshotString`, `convertSnapshot`, `convertSnapshotString`, and `convertSnapshotWithStats`. The parser validates Directus snapshot structure and supported versions; the transformer builds a typed intermediate schema with M2O and M2M relationship resolution; the generator emits deterministic alphabetically sorted DBML; and the type mapper covers PostgreSQL and Directus field types.

Added typed errors for invalid snapshots, oversized input, and validation failures. Added unit, CLI integration, and fuzz tests with fixtures for basic schemas, all field types, UTF-8 identifiers, Directus system tables, M2O/M2M relationships, circular references, large schemas, and malformed input. Added the benchmarking script.

Updated files: `src/index.ts`, `src/parser.ts`, `src/validator.ts`, `src/transformer.ts`, `src/generator.ts`, `src/type-map.ts`, `src/errors.ts`, `src/types.ts`, `bin/snap2dbml.js`, `settings.example.json`, `tests/`, `benchmarks/run.js`, `package.json`, and `README.md`.
