import { describe, expect, it } from 'vitest';

import { rewriteLinks } from '../../src/core/links/rewriteLinks';

describe('rewriteLinks', () => {
  it('renames a plain link', () => {
    expect(rewriteLinks('see [[Old]] here', 'Old', 'New')).toBe('see [[New]] here');
  });

  it('keeps the display label, which is the author’s text', () => {
    expect(rewriteLinks('[[Old|yesterday]]', 'Old', 'New')).toBe('[[New|yesterday]]');
  });

  it('keeps a folder qualification', () => {
    // The note is still in that folder; only its name changed.
    expect(rewriteLinks('[[Work/Old]]', 'Old', 'New')).toBe('[[Work/New]]');
  });

  it('matches regardless of case', () => {
    expect(rewriteLinks('[[old]]', 'Old', 'New')).toBe('[[New]]');
  });

  it('leaves other links alone', () => {
    expect(rewriteLinks('[[Other]] and [[Old]]', 'Old', 'New')).toBe('[[Other]] and [[New]]');
  });

  it('renames every occurrence', () => {
    expect(rewriteLinks('[[Old]] then [[Old]]', 'Old', 'New')).toBe('[[New]] then [[New]]');
  });

  it('does not touch links inside inline code', () => {
    // A note explaining the syntax must not be edited by a rename.
    expect(rewriteLinks('`[[Old]]` and [[Old]]', 'Old', 'New')).toBe('`[[Old]]` and [[New]]');
  });

  it('does not touch links inside fenced code blocks', () => {
    const text = '```\n[[Old]]\n```\n\n[[Old]]';

    expect(rewriteLinks(text, 'Old', 'New')).toBe('```\n[[Old]]\n```\n\n[[New]]');
  });

  it('preserves padding rather than tidying it', () => {
    // A rename is not the moment to reformat someone's document.
    expect(rewriteLinks('[[ Old ]]', 'Old', 'New')).toBe('[[ New ]]');
  });

  it('does not match a title that merely contains the old one', () => {
    expect(rewriteLinks('[[Old notes]]', 'Old', 'New')).toBe('[[Old notes]]');
  });

  it('returns the text unchanged when nothing matches', () => {
    const text = 'no links at all';

    expect(rewriteLinks(text, 'Old', 'New')).toBe(text);
  });

  it('ignores an empty old title', () => {
    expect(rewriteLinks('[[Old]]', '   ', 'New')).toBe('[[Old]]');
  });
});
