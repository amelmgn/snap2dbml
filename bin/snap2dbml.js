#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync, writeFileSync, readdirSync, unlinkSync, accessSync, statSync, mkdirSync, existsSync, constants as fsConstants } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  convertSnapshotWithStats,
  convertSnapshotToMarkdown,
  Snap2DBMLError,
  InvalidSnapshotError,
  FileTooLargeError,
} from '../dist/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'));

function loadSettings() {
  const candidates = [];

  if (process.env.SNAP2DBML_SETTINGS) {
    candidates.push(resolve(process.env.SNAP2DBML_SETTINGS));
  }
  candidates.push(resolve(process.cwd(), 'settings.json'));

  for (const settingsPath of candidates) {
    if (existsSync(settingsPath)) {
      try {
        return JSON.parse(readFileSync(settingsPath, 'utf-8'));
      } catch {
        process.stderr.write(`snap2dbml: Warning: Could not parse ${settingsPath}, using defaults.\n`);
      }
    }
  }
  return {};
}

const settings = loadSettings();

const program = new Command();

program
  .name('snap2dbml')
  .description('Convert Directus JSON snapshots to DBML format')
  .version(pkg.version)
  .argument('[file]', "Path to snapshot file (reads stdin if omitted or '-')")
  .option('-o, --output <file>', 'Write output to specified file')
  .option('--stdout', 'Write output to stdout instead of file')
  .option('--md', 'Also generate a Markdown collection description file alongside DBML')
  .option('--include-system', 'Include Directus system collections (directus_*)')
  .option('--include-comments', 'Include table/column comments from meta.note')
  .option('--max-size <mb>', 'Maximum input size in MB', '50')
  .option('--fail-on-circular', 'Exit with error on circular references')
  .option('--suppress-warnings', 'Suppress warning messages')
  .option('-v, --verbose', 'Show stats/metadata as JSON after output')
  .option('-q, --quiet', 'Suppress all non-error output (implies --suppress-warnings)')
  .action(async (file, opts) => {
    try {
      const quiet = opts.quiet ?? false;
      const suppressWarnings = quiet || opts.suppressWarnings;
      const maxSizeBytes = parseFloat(opts.maxSize) * 1024 * 1024;
      const generateMd = opts.md || settings.generateMarkdown || false;

      // Read input — if no file given, look in settings.inputFolder
      let input;
      if (file && file !== '-') {
        input = readInputFile(file, maxSizeBytes);
      } else if (file === '-') {
        input = await readStdin(maxSizeBytes);
      } else if (settings.inputFolder) {
        const inputDir = resolve(process.cwd(), settings.inputFolder);
        if (!existsSync(inputDir)) {
          throw new InvalidSnapshotError(`Input folder not found: ${settings.inputFolder}`, {
            suggestion: 'Check the inputFolder path in settings.json.',
          });
        }
        const jsonFiles = readdirSync(inputDir).filter(f => f.endsWith('.json'));
        if (jsonFiles.length === 0) {
          throw new InvalidSnapshotError(`No JSON files found in ${settings.inputFolder}`, {
            suggestion: 'Place a Directus snapshot JSON file in the input folder.',
          });
        }
        if (jsonFiles.length > 1) {
          throw new InvalidSnapshotError(
            `Multiple JSON files found in ${settings.inputFolder}: ${jsonFiles.join(', ')}`,
            { suggestion: 'Keep only one snapshot file in the input folder, or specify a file path directly.' },
          );
        }
        file = resolve(inputDir, jsonFiles[0]);
        input = readInputFile(file, maxSizeBytes);
      } else if (!process.stdin.isTTY) {
        input = await readStdin(maxSizeBytes);
      } else {
        throw new InvalidSnapshotError(
          'No input provided. Provide a file path, pipe to stdin, or set inputFolder in settings.json.',
          { suggestion: 'Usage: snap2dbml <file> or configure inputFolder in settings.json' },
        );
      }

      // Parse JSON
      let snapshot;
      try {
        snapshot = JSON.parse(input);
      } catch {
        throw new InvalidSnapshotError('File is not valid JSON.', {
          suggestion: 'Ensure the input is a valid JSON file exported by Directus.',
        });
      }

      const convertOptions = {
        includeSystem: opts.includeSystem,
        includeComments: opts.includeComments,
        maxSizeBytes,
        failOnCircularReference: opts.failOnCircular,
        suppressWarnings: true, // We handle warnings ourselves in the CLI
      };

      // Always convert to DBML
      const result = convertSnapshotWithStats(snapshot, convertOptions);

      // Determine output paths for DBML and Markdown
      let outputPath;
      let mdPath;
      if (opts.stdout) {
        outputPath = null;
        mdPath = null;
      } else if (opts.output) {
        outputPath = validateOutputPath(opts.output);
        // MD alongside explicit output: same dir, same base name, .md extension
        if (generateMd) {
          const base = outputPath.replace(/\.[^.]+$/, '');
          mdPath = base + '.md';
        }
      } else if (file && file !== '-') {
        // Default: write to outputFolder from settings (fallback: ./output)
        const outputDir = resolve(process.cwd(), settings.outputFolder || 'output');
        mkdirSync(outputDir, { recursive: true });
        const now = new Date();
        const ts = now.getFullYear().toString()
          + String(now.getMonth() + 1).padStart(2, '0')
          + String(now.getDate()).padStart(2, '0')
          + '_'
          + String(now.getHours()).padStart(2, '0')
          + String(now.getMinutes()).padStart(2, '0')
          + String(now.getSeconds()).padStart(2, '0');
        outputPath = resolve(outputDir, `schema_${ts}.dbml`);
        if (generateMd) {
          mdPath = resolve(outputDir, `description_${ts}.md`);
        }
      }

      // Clean previous files from output folder if configured
      if (outputPath && settings.cleanOutput) {
        const outDir = dirname(outputPath);
        if (existsSync(outDir)) {
          for (const f of readdirSync(outDir)) {
            const isDbml = f.endsWith('.dbml');
            const isMd = generateMd && f.endsWith('.md');
            if (isDbml || isMd) {
              const fullPath = resolve(outDir, f);
              if (fullPath !== outputPath && fullPath !== mdPath) {
                unlinkSync(fullPath);
              }
            }
          }
        }
      }

      // Write DBML
      if (outputPath) {
        writeFileSync(outputPath, result.dbml, 'utf-8');
        if (!quiet) {
          process.stderr.write(`Written to: ${outputPath}\n`);
        }
      } else {
        process.stdout.write(result.dbml);
      }

      // Generate and write Markdown alongside DBML (only when writing to a file)
      if (generateMd && mdPath) {
        const mdResult = convertSnapshotToMarkdown(snapshot, convertOptions);
        writeFileSync(mdPath, mdResult.markdown, 'utf-8');
        if (!quiet) {
          process.stderr.write(`Written to: ${mdPath}\n`);
        }
      }

      // Warnings
      if (!suppressWarnings && result.warnings.length > 0) {
        for (const w of result.warnings) {
          process.stderr.write(`snap2dbml warning: [${w.code}] ${w.message}\n`);
        }
      }

      // Verbose output
      if (opts.verbose && !quiet) {
        process.stderr.write(JSON.stringify({ stats: result.stats, metadata: result.metadata }) + '\n');
      }
    } catch (err) {
      handleError(err, opts.quiet);
    }
  });

program.parse();

function readInputFile(filePath, maxSizeBytes) {
  const resolved = resolve(filePath);

  // Check file exists
  try {
    accessSync(resolved, fsConstants.F_OK);
  } catch {
    process.stderr.write(`snap2dbml: File not found: ${filePath}\n`);
    process.exit(2);
  }

  // Check read permission
  try {
    accessSync(resolved, fsConstants.R_OK);
  } catch {
    process.stderr.write(`snap2dbml: Permission denied: ${filePath}\n`);
    process.exit(3);
  }

  // Check size
  const stat = statSync(resolved);
  if (stat.size > maxSizeBytes) {
    throw new FileTooLargeError(stat.size, maxSizeBytes);
  }

  return readFileSync(resolved, 'utf-8');
}

function readStdin(maxSizeBytes) {
  return new Promise((resolvePromise, reject) => {
    // Check if stdin has data (not a TTY)
    if (process.stdin.isTTY) {
      reject(new InvalidSnapshotError(
        'No input provided. Provide a file path or pipe input to stdin.',
        { suggestion: 'Usage: snap2dbml <file> or cat snapshot.json | snap2dbml' },
      ));
      return;
    }

    const chunks = [];
    let totalSize = 0;

    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => {
      totalSize += Buffer.byteLength(chunk, 'utf-8');
      if (totalSize > maxSizeBytes) {
        reject(new FileTooLargeError(totalSize, maxSizeBytes));
        process.stdin.destroy();
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on('end', () => {
      resolvePromise(chunks.join(''));
    });
    process.stdin.on('error', (err) => {
      reject(err);
    });
  });
}

function validateOutputPath(outputPath) {
  const resolved = resolve(outputPath);
  const cwd = process.cwd();
  if (!resolved.startsWith(cwd + '/') && resolved !== cwd) {
    process.stderr.write('snap2dbml: Output path must be within current working directory.\n');
    process.exit(1);
  }
  return resolved;
}

function handleError(err, quiet) {
  if (err instanceof Snap2DBMLError) {
    if (!quiet) {
      process.stderr.write(`snap2dbml: ${err.code}: ${err.message}\n`);
      if (err.suggestion) {
        process.stderr.write(`\nSuggestion: ${err.suggestion}\n`);
      }
    }
    process.exit(err.getExitCode());
  }

  // Unexpected errors
  if (!quiet) {
    process.stderr.write(`snap2dbml: Unexpected error: ${err.message || err}\n`);
  }
  process.exit(1);
}
