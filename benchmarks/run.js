#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertSnapshotWithStats } from '../dist/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(__dirname, '../tests/fixtures/large-schema.json');

const json = readFileSync(fixturePath, 'utf-8');
const snapshot = JSON.parse(json);

const ITERATIONS = 10;
const durations = [];

console.log(`Benchmark: ${ITERATIONS} iterations of convertSnapshotWithStats`);
console.log(`Fixture: ${snapshot.collections.length} collections, ${snapshot.fields.length} fields, ${snapshot.relations.length} relations`);
console.log('');

for (let i = 0; i < ITERATIONS; i++) {
  const result = convertSnapshotWithStats(snapshot, { suppressWarnings: true });
  durations.push(result.stats.durationMs);
}

durations.sort((a, b) => a - b);

const p50 = durations[Math.floor(durations.length * 0.5)];
const p95 = durations[Math.floor(durations.length * 0.95)];
const p99 = durations[durations.length - 1];
const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
const mem = process.memoryUsage();

console.log(`P50: ${p50.toFixed(2)}ms`);
console.log(`P95: ${p95.toFixed(2)}ms`);
console.log(`P99: ${p99.toFixed(2)}ms`);
console.log(`Avg: ${avg.toFixed(2)}ms`);
console.log('');
console.log(`Memory: ${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB heap used`);
console.log('');

if (p95 < 2000) {
  console.log('PASS: P95 < 2000ms target');
} else {
  console.log('FAIL: P95 >= 2000ms target');
  process.exit(1);
}
