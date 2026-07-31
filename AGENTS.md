## Project overview

`snap2dbml` converts Directus JSON schema snapshots into deterministic DBML and, optionally, Markdown documentation. It is an ESM TypeScript package for Node.js 18 or newer and exposes four entry points:

- the public library API in `src/index.ts`;
- the CLI in `bin/snap2dbml.js`;
- the HTTP service in `src/server.ts`;
- the scheduled Directus-to-GitHub sync flow in `src/sync.ts`.

Read `README.md` for user-facing behavior and `docs/tech-spec.md` for the architecture and invariants before making broad changes.

## Repository map

- `src/parser.ts` validates and parses Directus snapshots.
- `src/validator.ts` holds the structural validation assertions the parser uses.
- `src/transformer.ts` builds the intermediate schema model and resolves relationships.
- `src/type-map.ts` maps Directus field types to DBML types and lists the skipped virtual types.
- `src/generator.ts` renders deterministic DBML.
- `src/md-generator.ts` renders optional Markdown documentation.
- `src/conversion.ts` coordinates the shared conversion pipeline.
- `src/types.ts`, `src/errors.ts`, and `src/constants.ts` define shared public contracts.
- `src/version.ts` exposes `LIBRARY_VERSION`, read from `package.json`.
- `src/server.ts` implements the HTTP API and service lifecycle.
- `src/sync.ts`, `src/sync-config.ts`, `src/github-client.ts`, `src/syncer.ts`, and `src/scheduler.ts` implement automated sync.
- `src/logger.ts` provides the zero-dependency structured logger.
- `src/status.ts` provides the in-memory `StatusRegistry` behind `GET /status`.
- `tests/unit/`, `tests/integration/`, and `tests/fuzz/` contain Vitest suites.
- `tests/fixtures/` contains representative Directus snapshots.
- `tests/helpers/` contains shared test utilities such as the capturing logger.
- `benchmarks/` contains the performance harness run by `npm run benchmark`.
- `docs/prd.md` and `docs/tech-spec.md` contain the product and technical specifications.
- `dist/` is generated build output; do not edit it by hand.

## Setup and validation

Install dependencies with:

```bash
npm install
```

Use the narrowest relevant check while iterating, then run the full validation set before finishing:

```bash
npm run typecheck
npm test
npm run build
```

Other useful commands:

```bash
npm run test:watch
npm run test:coverage
npm run test:fuzz
npm run benchmark
```

Run a single test file with `npx vitest run path/to/file.test.ts`. The project does not currently define a lint or formatting script; do not invent one as a required check.

## Running the service

Run the HTTP service locally from the build output:

```bash
npm run build
API_KEY=your-secret npm start
```

It listens on port `3000`, reads `API_KEY`, `PORT`, `LOG_LEVEL`, and the sync variables from the environment, and starts the scheduler only when `SYNC_CONFIG` is set. Docker deployment uses one `docker/docker-compose.yml` and one shared `docker/.env` copied from `.env.example`.

The Compose project defines mutually exclusive `prod` and `stage` services:

- both publish host port `3000`, use the same runtime environment, and optionally mount the same `docker/sync.json`;
- `prod` pulls `ghcr.io/${GHCR_OWNER}/snap2dbml:${PROD_IMAGE_TAG:-prod}`;
- profile-gated `stage` pulls `ghcr.io/${GHCR_OWNER}/snap2dbml:${STAGE_IMAGE_TAG:-stage}`;
- stop the active service before starting the other so only one scheduler and port owner exists.

```bash
cd docker && docker compose up -d prod
cd docker && docker compose stop prod
cd docker && docker compose --profile stage up -d stage
```

For local image validation, use `docker build` and `docker run` on host port `3001`; there is no separate development Compose service. `.github/workflows/docker-publish.yml` publishes `stage` and `prod` branch tags plus immutable `sha-<short>` tags, and no `latest` tag. Keep the shared port, profile, log rotation limits, environment variables, and volume comments consistent with `README.md` and server behavior.

## Implementation conventions

- Keep TypeScript strict and avoid `any` unless an external boundary makes it unavoidable and the value is validated immediately.
- This package uses native ESM. Relative imports in TypeScript must include the `.js` extension, matching the existing source files.
- Preserve the pipeline boundaries: parsing and structural validation belong in the parser, Directus-to-model logic in the transformer, and output formatting in the generators.
- Keep conversion behavior shared through `src/conversion.ts`; avoid separate implementations for the library, CLI, and server.
- Preserve deterministic output. New collection, field, relationship, warning, or generated-document behavior must not depend on object insertion order, local time, or locale defaults.
- Reuse the typed errors and error/warning codes in `src/errors.ts` and `src/constants.ts`. User-facing failures should remain actionable and map to the documented CLI or HTTP behavior.
- Keep public API changes deliberate. When exports or observable behavior change, update `src/index.ts`, public types, CLI/API behavior, and documentation together as applicable.
- Follow the existing style: two-space indentation, single quotes, semicolons, trailing commas in multiline constructs, and small focused functions.
- Do not edit generated files in `dist/`, dependency contents in `node_modules/`, or local runtime output in `input/`, `output/`, and `temp/`.

## Logging and status

- Use the logger in `src/logger.ts` for all server, scheduler, and sync output. Do not add `console.*` calls in `src/` or `bin/`; the CLI writes its own human-readable messages directly to `process.stderr`.
- Obtain a logger with `createLogger()` or accept one through the existing config objects, and derive scoped loggers with `logger.child('scope')` instead of adding a scope field by hand.
- The service logs JSON lines on stdout; the one-shot `snap2dbml sync` command uses `createLogger({ format: 'text', stream: process.stderr })`. Keep that split: machine-readable for the long-running service, readable text for interactive CLI runs.
- Pick levels deliberately. `LOG_LEVEL` (default `info`) controls the threshold, and `/health` requests are logged at `debug` so container healthchecks stay out of the default stream.
- Pass structured data as fields rather than interpolating it into the message, so records stay greppable. Pass `Error` values as an `err` field; the logger serializes `message` and `stack`.
- Never log API keys, bearer tokens, authorization headers, or full snapshot payloads. Request logs strip the query string; keep it that way when touching `logRequest`.
- Keep `StatusRegistry` in `src/status.ts` accurate when sync behavior changes. Sync runs must report start, success with the `committed` flag, and failure, since `GET /status` reports per-target state and the recent log buffer.
- Use `tests/helpers/capture-logger.ts` to assert on log output instead of stubbing global console methods.

## Testing expectations

- Add or update tests for every behavior change and regression fix.
- Prefer unit tests for parser, transformer, generator, sync, scheduler, and client logic. Use integration tests when behavior crosses the CLI or HTTP boundary.
- Add a minimal fixture under `tests/fixtures/` only when an inline test object would obscure the case or several tests need the same snapshot.
- Assert observable behavior, warnings, error codes, and deterministic ordering; avoid assertions tied to incidental implementation details.
- For conversion changes, consider Directus snapshot versions 1 and 4, system collections, virtual fields, incomplete or circular relationships, unusual identifiers, defaults, and comments.
- Never make tests depend on real Directus, GitHub, or Telegram credentials. Mock network boundaries and time where needed.

## Configuration and security

- `settings.json`, `sync.json`, and `.env` are local files and are ignored by Git. Commit only sanitized examples such as `settings.example.json`, `sync.example.json`, and `.env.example`.
- Never commit API keys, bearer tokens, GitHub tokens, Telegram tokens, snapshot data from private Directus instances, or secrets copied from the environment.
- Keep network access bounded by the existing size limits, authentication rules, timeouts, and validation. Avoid logging authorization headers, tokens, or full sensitive payloads.
- Do not perform live GitHub writes, Telegram notifications, releases, or deployments unless the task explicitly requests them.

## Documentation and compatibility

- Update `README.md` when CLI flags, configuration, HTTP endpoints, exit/status codes, environment variables, or installation steps change.
- Update `docs/tech-spec.md` when architecture, data flow, invariants, or module responsibilities change.
- Record every user-visible change in `CHANGELOG.md`. Newest version first, one `## <version> [YYYY-MM-DD]` heading per release, followed by prose paragraphs that explain what changed and why, and an `Updated files:` line naming the touched paths. Match the existing entries rather than switching to a bullet or Keep a Changelog format.
- Add to the topmost entry while a version is unreleased; start a new heading only when the release is cut, and keep the version in sync with `package.json`, since `GET /status` reports it through `src/version.ts`.
- Keep examples and Docker configuration aligned with runtime behavior.
- Maintain Node.js 18 compatibility and support for the documented Directus snapshot formats unless a breaking change is explicitly requested.
