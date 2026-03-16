import { describe, expect, it } from 'vitest';
import { generateMarkdown } from '../../src/md-generator.js';
import type { SchemaModel } from '../../src/types.js';

function makeSchema(): SchemaModel {
  return {
    tables: [
      {
        name: 'users',
        isSystem: false,
        columns: [
          { name: 'id', type: 'uuid', isPrimaryKey: true, isNullable: false },
          {
            name: 'profile_id',
            type: 'uuid',
            isPrimaryKey: false,
            isNullable: true,
            defaultValue: "'foo|bar'",
            comment: 'line 1\nline 2 | extra',
          },
        ],
      },
    ],
    references: [
      {
        fromTable: 'users',
        fromColumn: 'profile_id',
        toTable: 'profiles',
        toColumn: 'id',
        relation: '-',
      },
    ],
    metadata: {
      directusVersion: '10.10.0',
      snapshotVersion: 1,
      generatedAt: '2026-03-16T00:00:00.000Z',
    },
  };
}

describe('generateMarkdown', () => {
  it('escapes table-breaking content in field settings', () => {
    const markdown = generateMarkdown(makeSchema(), { includeComments: true });
    const tableLines = markdown.split('\n').filter((line) => line.startsWith('|'));

    expect(tableLines).toHaveLength(4);
    expect(markdown).toContain("Default: 'foo\\|bar'; line 1<br>line 2 \\| extra");
  });

  it('labels one-to-one references as O2O', () => {
    const markdown = generateMarkdown(makeSchema());

    expect(markdown).toContain('| `profile_id` | uuid | No | O2O to profiles | Foreign Key; Default: \'foo\\|bar\' |');
  });
});
