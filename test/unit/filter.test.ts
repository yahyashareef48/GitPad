import { describe, expect, it } from 'vitest';

import { filterTree } from '../../src/shared/filterTree';
import type { TreeNodeDto } from '../../src/shared/protocol';

const tree: readonly TreeNodeDto[] = [
  {
    id: '/v/Work',
    name: 'Work',
    kind: 'folder',
    children: [
      { id: '/v/Work/Standup.pad', name: 'Standup', kind: 'document' },
      { id: '/v/Work/Budget.pad', name: 'Budget', kind: 'document' },
    ],
  },
  {
    id: '/v/Personal',
    name: 'Personal',
    kind: 'folder',
    children: [{ id: '/v/Personal/Books.pad', name: 'Books', kind: 'document' }],
  },
  { id: '/v/Inbox.pad', name: 'Inbox', kind: 'document' },
];

/** `name` / `parent/child` strings, so assertions read as a tree. */
function flatten(nodes: readonly TreeNodeDto[], prefix = ''): string[] {
  return nodes.flatMap((node) => [
    `${prefix}${node.name}`,
    ...flatten(node.children ?? [], `${prefix}${node.name}/`),
  ]);
}

describe('filterTree', () => {
  it('returns everything for an empty query', () => {
    expect(filterTree(tree, '')).toBe(tree);
    expect(filterTree(tree, '   ')).toBe(tree);
  });

  it('keeps matching documents and the folders leading to them', () => {
    // "Work" itself does not match, but it must survive as the path to Budget.
    expect(flatten(filterTree(tree, 'budget'))).toEqual(['Work', 'Work/Budget']);
  });

  it('ignores case', () => {
    expect(flatten(filterTree(tree, 'INBOX'))).toEqual(['Inbox']);
  });

  it('matches on a substring, not just a prefix', () => {
    expect(flatten(filterTree(tree, 'tand'))).toEqual(['Work', 'Work/Standup']);
  });

  it('keeps everything inside a folder whose own name matches', () => {
    // Having found the folder you searched for, hiding its contents would be
    // perverse.
    expect(flatten(filterTree(tree, 'work'))).toEqual([
      'Work',
      'Work/Standup',
      'Work/Budget',
    ]);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterTree(tree, 'zzz')).toEqual([]);
  });

  it('drops folders that lead nowhere', () => {
    expect(flatten(filterTree(tree, 'books'))).toEqual(['Personal', 'Personal/Books']);
  });
});
