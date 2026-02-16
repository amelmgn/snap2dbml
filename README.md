# snap2dbml

Convert [Directus](https://directus.io/) JSON schema snapshots into [DBML](https://dbml.dbdiagram.io/) (Database Markup Language) format for use with database diagramming tools like [dbdiagram.io](https://dbdiagram.io/).

## Why?

Directus stores schema in a proprietary JSON format that isn't compatible with standard database visualization tools. snap2dbml bridges that gap — giving you clean, diffable DBML output from your existing Directus snapshots, with no manual documentation needed.

## Installation

```bash
npm install snap2dbml
```

Requires **Node.js >= 18.0.0**.

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
  "cleanOutput": true
}
```

| Setting | Description |
|---------|-------------|
| `inputFolder` | Folder containing your Directus snapshot JSON file. Used when no file argument is passed. |
| `outputFolder` | Folder where generated DBML files are written. |
| `cleanOutput` | When `true`, deletes previous `.dbml` files from the output folder before writing a new one. |

Paths can be relative (to the working directory) or absolute.

### CLI

```bash
# Convert using settings.json (reads from inputFolder, writes to outputFolder)
snap2dbml

# Convert a specific snapshot file
snap2dbml snapshot.json

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
```

## CLI Options

```
Usage: snap2dbml [options] [file]

Arguments:
  file                      Path to snapshot file (reads stdin if omitted or '-')

Options:
  -o, --output <file>       Write output to file (default: stdout)
  --stdout                  Explicitly output to stdout
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

Given a Directus snapshot, snap2dbml produces:

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

## Features

- **Directus v10.x and v11.x** snapshot support
- **All standard field types** — uuid, string, integer, float, decimal, boolean, timestamp, json, and more
- **Relationships** — M2O, O2M, M2M, and O2O with proper DBML `Ref:` syntax
- **M2M junction tables** with metadata columns
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
  UnsupportedFieldError,
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

The conversion pipeline is a three-stage process:

```
JSON Input → Parser → Transformer → Generator → DBML Output
```

1. **Parser** — validates structure, enforces size/depth limits, checks Directus version compatibility
2. **Transformer** — filters system collections, maps field types, resolves relationships, detects circular references
3. **Generator** — produces sorted, deterministic DBML with proper escaping

## Performance

| Schema Size | Target |
|-------------|--------|
| 50 collections, 500 fields | < 500ms |
| 200 collections, 2,000 fields | < 2s |
| Memory (200 collections) | < 100MB heap |
| Bundled package size | ~27KB |
