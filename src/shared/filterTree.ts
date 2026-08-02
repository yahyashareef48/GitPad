import type { TreeNodeDto } from './protocol';

/*
 * Filtering the tree by a search term.
 *
 * Lives in shared/ because the webview runs it. It deliberately does NOT live
 * in core/: core imports node:path, and the webview tsconfig has no Node types
 * -- pulling core into the webview is exactly the environment mixing the two
 * tsconfigs exist to prevent.
 *
 * Runs against the tree the webview already holds, so typing is instant and
 * needs no round trip. This matches titles only; full-text search over note
 * CONTENTS is a separate feature with its own index (plan 2.9).
 */

/**
 * Keeps nodes whose name matches, plus every ancestor needed to reach them.
 *
 * A folder that matches keeps all its descendants: having searched for "Work"
 * and found the folder, hiding what is inside it would be perverse.
 */
export function filterTree(
  nodes: readonly TreeNodeDto[],
  query: string,
): readonly TreeNodeDto[] {
  const needle = query.trim().toLowerCase();

  if (needle === '') {
    return nodes;
  }

  return nodes.flatMap((node) => keepMatching(node, needle));
}

function keepMatching(node: TreeNodeDto, needle: string): readonly TreeNodeDto[] {
  const matches = node.name.toLowerCase().includes(needle);

  if (node.children === undefined) {
    return matches ? [node] : [];
  }

  if (matches) {
    return [node];
  }

  const children = node.children.flatMap((child) => keepMatching(child, needle));

  // An unmatched folder survives only as a path to something that did match.
  return children.length === 0 ? [] : [{ ...node, children }];
}
