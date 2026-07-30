# PRD: Directus Snapshot to DBML Translator (`snap2dbml`)

## Executive Summary
`snap2dbml` is a developer tool that automates the conversion of Directus's proprietary JSON schema snapshots into the standard DBML (Database Markup Language) format. It eliminates the manual, error-prone process of creating database diagrams, giving teams instant visual documentation compatible with tools like dbdiagram.io. The tool is delivered as a tri-mode package: a Command Line Interface (CLI) for ad-hoc use, a Node.js library for integration into CI/CD pipelines, and an HTTP backend service for automation workflows (n8n, webhooks, external tooling).

## Problem Statement / Opportunity
**Problem**: Teams using Directus lack a straightforward way to generate visual, shareable database schema documentation, creating friction in development, review, and stakeholder communication.
*   **Evidence of Pain**:
    *   **Community Analysis**: Directus GitHub discussions frequently request schema visualization (e.g., discussions requesting "Schema visualization tool?", "Export schema to DBML"). Over 60 threads in the past year mention diagramming challenges.
    *   **User Interviews**: Interviews with 8 Directus developers revealed consistent pain: 6 cited spending 1-3 hours weekly manually updating ER diagrams that quickly fall out of sync. All expressed frustration at being locked out of standard DB tooling.
*   **Specific Pains**:
    1.  **Manual Documentation Overhead**: Developers manually recreate diagrams in external tools after schema changes.
    2.  **Tooling Exclusion**: Directus's internal JSON format locks schema data away from popular database visualization and analysis tools (dbdiagram.io, JetBrains IDEs, AI code assistants).
    3.  **Collaboration Barrier**: Non-technical team members and clients cannot comprehend raw JSON snapshots, forcing developers to act as translators.
    4.  **Opaque Schema Evolution**: Comparing schema changes between Git commits or Directus versions is difficult with complex JSON diffs.

**Opportunity**: Provide a reliable, automated bridge between Directus and the DBML ecosystem, enabling:
*   **Instant Visual Documentation**: One-command generation of diagrams for reviews and onboarding.
*   **Enhanced Toolchain Integration**: Schema data usable in any tool that supports DBML.
*   **Improved Collaboration**: Human-readable schema representations for all stakeholders.
*   **Foundation for Automation**: Enabling automated schema diffing and documentation in CI/CD.

## Target Users / Personas

### Primary Persona: Maya, Full-Stack Developer at a Digital Agency
*   **Role**: Builds client projects using Directus as a headless CMS. Manages 2-3 Directus instances simultaneously.
*   **Technical Level**: High. Daily user of Node.js, Git, and CLI tools.
*   **Goals**: Ship features fast; keep project documentation accurate with minimal effort; integrate tools into automated workflows.
*   **Pain Points**: Hates context-switching to update Confluence diagrams; needs to quickly explain data models to frontend colleagues; manual steps break her CI/CD ethos.
*   **Tools**: VS Code, GitHub Actions, npm, dbdiagram.io.
*   **Usage Pattern**: Will run the CLI locally after schema tweaks and integrate the library into a GitHub Action to regenerate docs on every merge to `main`.

### Primary Persona: David, Technical Lead at a Product Company
*   **Role**: Oversees backend architecture and data model design for a SaaS product built on Directus.
*   **Technical Level**: Expert. Deep knowledge of SQL and database design patterns.
*   **Goals**: Ensure schema scalability and integrity; facilitate clear design discussions; onboard new engineers efficiently.
*   **Pain Points**: Reviewing PRs with schema changes requires mentally parsing JSON; lacks a single source of truth for the current production schema diagram.
*   **Tools**: Pull Requests, architecture review meetings, Notion for docs.
*   **Usage Pattern**: Will use the CLI to generate a DBML file for pre-review analysis and ensure the generated diagram is part of the official project documentation.

### Beneficiary Persona: Sarah, Project Manager at a Consulting Firm
*   **Role**: Manages client deliverables, timelines, and communication. Non-technical stakeholder.
*   **Technical Level**: Low. Proficient with web apps and visual tools, not code.
*   **Goals**: Understand project scope; communicate data requirements and relationships to clients; validate that the built system matches agreed-upon structures.
*   **Pain Points**: Entirely dependent on developers to explain what "the database" looks like; receives outdated PDFs or confusing SQL snippets.
*   **Tools**: Email, Zoom, Google Docs, dbdiagram.io (viewer mode).
*   **Relationship to Tool**: Does **not** use `snap2dbml` directly. Is a beneficiary of its output, receiving a URL to a dbdiagram.io diagram from a developer to use in client meetings and requirement validation.

## User Stories / Use Cases

### Core User Stories
1.  **As** Maya, a Developer,
    **I want to** run a simple CLI command pointing to my snapshot file,
    **so that** I can instantly get a DBML output to use with dbdiagram.io and see an accurate visual diagram of my current schema.

2.  **As** Maya, a Developer,
    **I want to** programmatically convert a snapshot JSON object to a DBML string via a Node.js library function,
    **so that** I can automate documentation generation in my deployment or build scripts.

3.  **As** David, a Tech Lead,
    **I want to** generate a clean, standardized DBML file from a snapshot,
    **so that** I can quickly review table structures, keys, and relationships during architecture reviews without deciphering Directus-specific JSON.

4.  **As** David, a Tech Lead,
    **I want** the tool to produce deterministic, consistently formatted DBML output,
    **so that** I can use a standard text diff tool to clearly understand schema changes between two snapshot versions (e.g., `main` vs. `feature-branch`).

5.  **As** Sarah, a Project Manager,
    **I want to** be given a link to a visual database diagram by a developer,
    **so that** I can independently understand what data entities the project manages and explain them to my client.

### Supporting & Edge Case Stories
6.  **As** Maya, a Developer,
    **I want** clear, actionable error messages if my input file is invalid or malformed,
    **so that** I can fix the issue immediately without searching through documentation.

7.  **As** a Developer on a project using Directus 10,
    **I want** the tool to support snapshots from Directus 10.x,
    **so that** I can use it without being forced to upgrade my Directus instance.

8.  **As** Maya, a Developer,
    **I want** to exclude Directus system tables (like `directus_users`) from the output by default,
    **so that** my diagram focuses on my application's data model.

9.  **As** a Developer,
    **I want** M2M junction tables that contain additional metadata columns (beyond the two foreign keys) to be represented correctly as full tables,
    **so that** the diagram accurately reflects the complete structure of my many-to-many relationships.

10. **As** a Developer working with international teams,
    **I want** the tool to correctly handle table and column names containing non-ASCII characters (UTF-8),
    **so that** our localized schema is translated accurately.

11. **As** Maya, a Developer using n8n for automation,
    **I want to** send a Directus snapshot to a self-hosted HTTP endpoint and receive DBML and Markdown in the response,
    **so that** I can integrate schema conversion into automated workflows without installing the CLI on every machine.

## Functional Requirements
*   **FR1: CLI Interface**
    *   FR1.1: Accept a file path to a Directus JSON snapshot as a positional argument.
    *   FR1.2: Accept JSON input directly from `stdin` to support piping (`cat snapshot.json | snap2dbml`).
    *   FR1.3: Output valid DBML to `stdout` by default.
    *   FR1.4: Support an `--output <file>` / `-o <file>` flag to write DBML to a specified file.
    *   FR1.5: Support a `--include-system` flag to include Directus system collections in the output.
    *   FR1.6: Support standard `--help` and `--version` flags.
    *   FR1.7: Support a `--md` flag that, when file-based output is used, generates a Markdown collection description file (`.md`) alongside the DBML file — both sharing the same base filename in the output folder.
    *   FR1.8: Support a `generateMarkdown` boolean key in `settings.json` as a persistent alternative to `--md`.

*   **FR2: Library Interface (Node.js)**
    *   FR2.1: Export a primary `convertSnapshot()` function that accepts a parsed JSON object and returns a DBML string.
    *   FR2.2: Export a helper function that accepts a JSON string and returns a DBML string.
    *   FR2.3: Provide full TypeScript type definitions for function inputs and outputs.
    *   FR2.4: Throw consistent, typed error objects (e.g., `InvalidSnapshotError`, `ValidationError`) with descriptive messages.
    *   FR2.5: Export `convertSnapshotToMarkdown()` that accepts a parsed JSON object and returns a `MarkdownConvertResult` with the Markdown string plus warnings, stats, and metadata.
    *   FR2.6: Export low-level `generateMarkdown(schema, options)` for use with an already-transformed `SchemaModel`.

*   **FR3: Schema Translation Core**
    *   FR3.1: Map each Directus "collection" to a DBML `Table`.
    *   FR3.2: Map each Directus "field" to a DBML `Column`.
    *   FR3.3: Translate common Directus field types (e.g., `string`, `integer`, `boolean`, `timestamp`) to appropriate SQL/DBML types.
    *   FR3.4: Correctly identify and mark primary key fields.
    *   FR3.5: Translate Directus relationship types (M2O, O2M, M2M) into correct DBML `Ref:` syntax.
    *   FR3.6: For M2M relationships, represent junction tables as full tables (not just references), including any additional metadata columns beyond the foreign keys.
    *   FR3.7: Apply `null` or `not null` constraints based on Directus field `meta`.
    *   FR3.8: Include column `default` values where defined in the snapshot.
    *   FR3.9: By default, filter out collections whose name starts with `directus_`.
    *   FR3.10: Correctly handle table and column names containing non-ASCII (UTF-8) characters.
    *   FR3.11: Annotate Directus virtual relationship fields (`alias` fields with `o2m`, `m2m`, or `translations` specials) as DBML comments within their parent table, preserving visibility of relationships that exist in the Directus UI but have no physical database column. Pure UI layout aliases (e.g., field groups) are excluded.

*   **FR5: HTTP Server Interface**
    *   FR5.1: Expose a `POST /convert` endpoint accepting a JSON body with a `snapshot` field (Directus snapshot object) and optional `generateMarkdown` boolean and `options` object.
    *   FR5.2: Return a JSON response with fields: `dbml` (string), `md` (string or null), `warnings`, `stats`, and `metadata`.
    *   FR5.3: Expose a `GET /health` endpoint returning `{"status":"ok"}` without authentication, for use with container health checks and monitoring.
    *   FR5.4: Support API key authentication via an `X-API-Key` request header, configured through the `API_KEY` environment variable. Authentication is skipped if `API_KEY` is not set.
    *   FR5.5: Reject request bodies exceeding 50 MB with HTTP 413.
    *   FR5.6: Return HTTP 422 with an `error` field when the snapshot conversion fails (e.g., invalid snapshot structure).
    *   FR5.7: Be deployable as a Docker container via the provided `Dockerfile` and `docker-compose.yml`. Port is configurable via the `PORT` environment variable (default: 3000).

*   **FR4: Error Handling & Validation**
    *   FR4.1: Validate input is parseable JSON.
    *   FR4.2: Validate input JSON conforms to the basic structure of a Directus snapshot (e.g., has `collections` and `fields` arrays).
    *   FR4.3: Provide error messages that specify the nature of the problem and, when possible, suggest a fix (e.g., "File is not valid JSON." or "Snapshot missing required 'collections' property.").
    *   FR4.4: CLI must exit with a non-zero status code on any error.
    *   FR4.5: For unrecognized Directus field types, map to a generic type (e.g., `text`) and emit a warning to stderr with the field name and original type.

## Non-Functional Requirements
*   **NFR1: Performance**: Process a snapshot containing 200 collections and 2,000 fields in under 2 seconds on a standard developer laptop (e.g., MacBook Pro M1).
*   **NFR2: Compatibility**:
    *   Runtime: Support Node.js 18.x LTS and later.
    *   Input: Support the snapshot format exported by Directus versions 10.x and 11.x.
*   **NFR3: Reliability & Accuracy**: Output DBML must correctly represent 100% of supported schema constructs (tables, columns, keys, relationships, constraints) from valid input snapshots. Verification will be via automated tests against a suite of real and synthetic snapshot fixtures.
*   **NFR4: Deterministic Output**: Given the same input snapshot, the tool must always produce an identical DBML string (byte-for-byte). This is required for reliable diffing and scriptable automation.
*   **NFR5: Developer Experience**:
    *   Zero runtime dependencies for the core conversion library. The CLI binary may depend on a lightweight argument parser.
    *   Package size (bundled) under 100KB.
    *   Comprehensive README with installation, CLI examples, library API examples, and a troubleshooting guide.
*   **NFR6: Maintainability**: Code must be well-structured with JSDoc comments and follow standard linting rules. Public API must be stable within a major version.

## Success Metrics / KPIs
| Metric | Target | Measurement Method & Notes |
| :--- | :--- | :--- |
| **User Adoption** | 500+ weekly npm downloads within 3 months of v1.0 release. | npm package download statistics. |
| **Tool Reliability** | 99.5% of conversion attempts on valid snapshots from supported Directus versions succeed without throwing an error. | Instrumentation within the tool logging success/failure (anonymized, opt-in). |
| **Conversion Performance** | 95% of executions meet the NFR1 target (<2s for 200 tables). | Same performance instrumentation. |
| **Developer Satisfaction** | Average rating of ≥ 4.0 out of 5 on "ease of use" and "meets needs" from early adopters. | Short, optional survey presented to users after 10 successful CLI runs or library calls (sampling bias acknowledged). |

## Scope
### In Scope
*   Converting Directus **JSON** snapshot format to valid DBML.
*   Optionally generating a human-readable Markdown file describing each collection's fields (Field, Type, Required, Relation, Settings) alongside the DBML output — enabled via `--md` CLI flag, `generateMarkdown` setting, or `generateMarkdown` HTTP request field.
*   Providing a standalone CLI tool.
*   Providing a Node.js library with a clean, documented API.
*   Providing a stateless HTTP backend service (`POST /convert`) deployable via Docker, with API key authentication and a `/health` endpoint.
*   Translating core schema constructs: tables, columns, data types, primary keys, and relationships (M2O, O2M, M2M).
*   Full representation of M2M junction tables including metadata columns.
*   Basic field constraints: nullability and default values.
*   Filtering of Directus system collections (with an opt-in flag).
*   Support for non-ASCII (UTF-8) table and column names.
*   Annotation of virtual relationship fields (O2M, M2M, translations aliases) as DBML comments.
*   Deterministic output formatting to enable diffing.

### Out of Scope
*   Support for Directus YAML snapshot format.
*   Translation of Directus-specific metadata (interfaces, display templates, validation rules). Note: virtual relationship aliases (O2M, M2M, translations) are annotated as DBML comments — see FR3.11.
*   Reverse engineering (DBML to Directus snapshot).
*   Direct API integration with any visualization service (e.g., dbdiagram.io).
*   Graphical User Interface (GUI).
*   Schema diff visualization (tool enables diffing, but does not create visual diffs).
*   Schema migration or synchronization capabilities.
*   Support for Directus versions prior to 10.0.
*   Custom field type mapping configuration (may be added in future versions).
*   Built-in TLS/HTTPS termination for the HTTP server (handled by a reverse proxy such as nginx).

## Dependencies
| Dependency | Type | Risk & Notes |
| :--- | :--- | :--- |
| **Directus Snapshot Format Stability** | External / Input | **MEDIUM**. The format is not a public API and may change in major releases. Mitigation: Version detection logic, a documented compatibility matrix, and a process for community-contributed test fixtures for new versions. |
| **DBML Specification** | External / Output | **LOW**. DBML is a stable, open specification. We target a well-supported subset. |
| **Node.js Runtime (v18+)** | Runtime | **LOW**. Standard, widely available environment. |
| **`commander` (or similar CLI lib)** | Runtime (for CLI) | **LOW**. Mature, stable library for parsing CLI arguments. A direct dependency of the published CLI binary. |
| **Docker** | Deployment (HTTP server) | **LOW**. Standard container runtime for VPS deployment. The HTTP server can also run without Docker via `npm start`. |
| **Testing Framework (`vitest`/`jest`)** | Development | **LOW**. Standard tooling. |

## Risks and Mitigations
| Risk | Impact | Likelihood | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **Directus changes its snapshot format** in a future version, breaking the translator. | High | Medium | 1. Implement snapshot version detection from metadata. 2. Maintain and expand a suite of test fixtures for each major Directus version. 3. Foster community contribution of fixtures for new versions. 4. Clearly document supported versions and add warnings for unsupported ones. |
| **Performance degrades** with extremely large, complex schemas (500+ tables). | Medium | Low | 1. Set and monitor performance benchmark (NFR1) with a large schema. 2. Profile and optimize the translation algorithm, focusing on linear time complexity. 3. Document known limits. |
| **Custom or future Directus field types** cannot be mapped to a sensible DBML/SQL type. | Medium | Medium | 1. Map known types; for unknown types, default to a generic type (e.g., `text`) and log a warning (FR4.5). 2. Consider adding custom type mapping configuration in a future version based on user demand. |
| **A competitor emerges** or **Directus adds native DBML export**, reducing the tool's unique value. | High | Low-Medium | 1. Focus on superior developer experience (DX), speed, deterministic output, and seamless library integration. 2. Explore adjacent value-add features based on user feedback (e.g., snapshot diffing, custom templates). 3. Build community and ecosystem around the tool. |
| **The target market (Directus devs needing diagrams) is too small** for sustainable adoption. | High | Low | 1. Validate demand via pre-launch sign-ups, GitHub stars, and community engagement. 2. Position the tool as essential for teams practicing schema review and documentation, not just for individual developers. |
