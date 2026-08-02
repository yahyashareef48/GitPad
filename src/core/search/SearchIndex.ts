import * as path from 'node:path';

import { parseDocument } from '../markdown/frontmatter';
import type { FileSystem } from '../ports/FileSystem';
import type { Logger } from '../ports/Logger';
import { isVisibleFile, isVisibleFolder } from '../vault/visibility';

/*
 * Full-text search over note contents.
 *
 * The sidebar's box already filters by TITLE, instantly, from the tree the
 * webview holds. This is the other half: finding the note where you wrote a
 * particular sentence, which is the thing you actually cannot do otherwise.
 *
 * Built in memory from a vault scan, with no persisted cache. A vault is
 * thousands of small text files at most; an index on disk would need
 * invalidation, and an index that can disagree with the notes is worse than
 * one rebuilt when needed (plan 1.6).
 */

export interface SearchHit {
  readonly id: string;
  readonly title: string;
  /** A line containing the match, for context in the results list. */
  readonly excerpt: string;
  /** Ranking score; higher is better. */
  readonly score: number;
}

interface IndexedNote {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly lowerTitle: string;
  readonly lowerBody: string;
}

export class SearchIndex {
  private notes: readonly IndexedNote[] = [];

  public constructor(
    private readonly fs: FileSystem,
    private readonly logger: Logger,
    private readonly extensions: ReadonlySet<string>,
  ) {}

  public async build(root: string): Promise<void> {
    const files = await this.collect(root);
    const notes: IndexedNote[] = [];

    for (const file of files) {
      const text = await this.read(file);

      if (text === undefined) {
        continue;
      }

      // Frontmatter is metadata, not content -- searching for "created" should
      // not return every note ever made.
      const body = parseDocument(text).body;
      const title = path.parse(file).name;

      notes.push({
        id: file,
        title,
        body,
        lowerTitle: title.toLowerCase(),
        lowerBody: body.toLowerCase(),
      });
    }

    this.notes = notes;
    this.logger.debug(`Search index built: ${notes.length} notes`);
  }

  /**
   * Finds notes matching every word in the query.
   *
   * All terms must appear, but not adjacently -- searching "budget meeting"
   * should find a note about the meeting where the budget came up, which a
   * phrase match would miss.
   */
  public search(query: string, limit = 30): readonly SearchHit[] {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term !== '');

    if (terms.length === 0) {
      return [];
    }

    const hits: SearchHit[] = [];

    for (const note of this.notes) {
      const score = scoreNote(note, terms);

      if (score > 0) {
        hits.push({
          id: note.id,
          title: note.title,
          excerpt: findExcerpt(note.body, terms),
          score,
        });
      }
    }

    return hits.sort((left, right) => right.score - left.score).slice(0, limit);
  }

  private async collect(root: string): Promise<readonly string[]> {
    const entries = await this.fs.readDirectory(root).catch(() => []);
    const files: string[] = [];

    for (const entry of entries) {
      const full = path.join(root, entry.name);

      if (entry.kind === 'directory') {
        if (isVisibleFolder(entry.name)) {
          files.push(...(await this.collect(full)));
        }
      } else if (isVisibleFile(entry.name, this.extensions)) {
        files.push(full);
      }
    }

    return files;
  }

  private async read(file: string): Promise<string | undefined> {
    try {
      return new TextDecoder().decode(await this.fs.readFile(file));
    } catch (error) {
      // One unreadable note must not fail the whole index.
      this.logger.warn(`Skipping ${file} while indexing`, error);

      return undefined;
    }
  }
}

/** Zero when any term is missing; higher when matches are in the title. */
function scoreNote(note: IndexedNote, terms: readonly string[]): number {
  let score = 0;

  for (const term of terms) {
    const inTitle = note.lowerTitle.includes(term);
    const inBody = note.lowerBody.includes(term);

    if (!inTitle && !inBody) {
      return 0;
    }

    /*
     * A title match counts for far more than a body match.
     *
     * Someone searching "budget" almost always wants the note CALLED budget,
     * not the twenty notes that mention it in passing.
     */
    if (inTitle) {
      score += note.lowerTitle === term ? 100 : 10;
    }

    if (inBody) {
      score += 1;
    }
  }

  return score;
}

/** The first line containing any term, trimmed to something readable. */
function findExcerpt(body: string, terms: readonly string[]): string {
  const lines = body.split(/\r?\n/);

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (line.trim() !== '' && terms.some((term) => lower.includes(term))) {
      return truncate(line.trim());
    }
  }

  // Title-only match: show the opening line so the result is not blank.
  return truncate(lines.find((line) => line.trim() !== '')?.trim() ?? '');
}

function truncate(line: string, max = 120): string {
  return line.length <= max ? line : `${line.slice(0, max).trimEnd()}…`;
}
