import { describe, expect, it } from 'vitest';
import { codeFromKey } from '../src/keyFallback';

describe('codeFromKey', () => {
  it('maps letters, digits and space to physical-key codes', () => {
    expect(codeFromKey('w')).toBe('KeyW');
    expect(codeFromKey('D')).toBe('KeyD');
    expect(codeFromKey('3')).toBe('Digit3');
    expect(codeFromKey(' ')).toBe('Space');
  });

  it('keeps multi-character key values that already match their code', () => {
    expect(codeFromKey('Enter')).toBe('Enter');
    expect(codeFromKey('ArrowLeft')).toBe('ArrowLeft');
    expect(codeFromKey('Escape')).toBe('Escape');
  });

  it('normalises legacy names and punctuation', () => {
    expect(codeFromKey('Esc')).toBe('Escape');
    expect(codeFromKey('Up')).toBe('ArrowUp');
    expect(codeFromKey(',')).toBe('Comma');
  });

  it('returns an empty code for keys it cannot place', () => {
    expect(codeFromKey('é')).toBe('');
  });
});
