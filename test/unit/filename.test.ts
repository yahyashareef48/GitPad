import { describe, expect, it } from 'vitest';

import {
  UNTITLED,
  nextUntitledStem,
  titleToStem,
  uniquifyStem,
} from '../../src/core/naming/filename';

describe('titleToStem', () => {
  it('leaves an ordinary title alone', () => {
    expect(titleToStem('Standup notes')).toBe('Standup notes');
  });

  it('keeps non-ASCII characters, which are legal in filenames', () => {
    expect(titleToStem('Café — 日本語')).toBe('Café — 日本語');
  });

  it('replaces characters Windows forbids with spaces', () => {
    expect(titleToStem('Q1: results')).toBe('Q1 results');
    expect(titleToStem('a/b\\c')).toBe('a b c');
    expect(titleToStem('what? *now* <ok>')).toBe('what now ok');
  });

  it('collapses the whitespace that substitution creates', () => {
    expect(titleToStem('a  ///  b')).toBe('a b');
  });

  it('strips control characters', () => {
    // Built by code point: raw control bytes in a source file are invisible
    // in most editors and easily mangled by tooling.
    const control = (code: number) => String.fromCharCode(code);
    const raw = `a${control(0)}b${control(0x1f)}c${control(0x7f)}d`;

    expect(titleToStem(raw)).toBe('abcd');
  });

  it('treats tab and newline as word separators, not noise to delete', () => {
    const nl = String.fromCharCode(10);
    const tab = String.fromCharCode(9);

    expect(titleToStem(`line one${nl}line two`)).toBe('line one line two');
    expect(titleToStem(`a${tab}b`)).toBe('a b');
  });

  it('trims trailing dots and spaces, which Windows silently drops', () => {
    expect(titleToStem('notes...')).toBe('notes');
    expect(titleToStem('notes   ')).toBe('notes');
    expect(titleToStem('notes . . ')).toBe('notes');
  });

  it('keeps dots that are not trailing', () => {
    expect(titleToStem('v1.2 plan')).toBe('v1.2 plan');
  });

  it('falls back to Untitled when nothing survives', () => {
    expect(titleToStem('')).toBe(UNTITLED);
    expect(titleToStem('   ')).toBe(UNTITLED);
    expect(titleToStem('///')).toBe(UNTITLED);
    expect(titleToStem('...')).toBe(UNTITLED);
  });

  it('escapes reserved DOS device names, regardless of case', () => {
    expect(titleToStem('CON')).toBe('CON_');
    expect(titleToStem('con')).toBe('con_');
    expect(titleToStem('NUL')).toBe('NUL_');
    expect(titleToStem('com1')).toBe('com1_');
    expect(titleToStem('LPT9')).toBe('LPT9_');
  });

  it('does not escape names that merely start with a reserved word', () => {
    expect(titleToStem('console log')).toBe('console log');
    expect(titleToStem('com10')).toBe('com10');
  });

  it('caps length and leaves no trailing space behind', () => {
    const stem = titleToStem('x'.repeat(300));

    expect(stem).toHaveLength(200);
    expect(stem).toBe('x'.repeat(200));
  });

  it('does not end in a space after truncation', () => {
    // 199 x's, then a space, then more -- truncation lands on the space.
    const stem = titleToStem(`${'x'.repeat(199)} tail`);

    expect(stem.endsWith(' ')).toBe(false);
    expect(stem).toBe('x'.repeat(199));
  });
});

describe('uniquifyStem', () => {
  it('returns the stem unchanged when it is free', () => {
    expect(uniquifyStem('Notes', [])).toBe('Notes');
    expect(uniquifyStem('Notes', ['Other'])).toBe('Notes');
  });

  it('starts suffixing at 2, since the bare name is the first', () => {
    expect(uniquifyStem('Notes', ['Notes'])).toBe('Notes 2');
    expect(uniquifyStem('Notes', ['Notes', 'Notes 2'])).toBe('Notes 3');
  });

  it('skips gaps rather than filling them', () => {
    expect(uniquifyStem('Notes', ['Notes', 'Notes 3'])).toBe('Notes 2');
  });

  it('compares case-insensitively, because Windows and macOS do', () => {
    // Returning "Notes" here would collide on write for the same user.
    expect(uniquifyStem('Notes', ['notes'])).toBe('Notes 2');
    expect(uniquifyStem('notes', ['NOTES', 'Notes 2'])).toBe('notes 3');
  });
});

describe('nextUntitledStem', () => {
  it('numbers untitled notes so each has a distinct filename', () => {
    expect(nextUntitledStem([])).toBe('Untitled');
    expect(nextUntitledStem(['Untitled'])).toBe('Untitled 2');
    expect(nextUntitledStem(['Untitled', 'Untitled 2'])).toBe('Untitled 3');
  });
});
