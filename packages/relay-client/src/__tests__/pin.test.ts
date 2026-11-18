import { describe, expect, it } from 'vitest';
import { pinPrompt } from '../pin';

describe('the PIN gate’s prompt', () => {
  it('stays away while the computer is open or silent, and asks for what it needs otherwise', () => {
    expect(pinPrompt(undefined, false)).toBeNull();
    expect(pinPrompt({ kind: 'unlocked' }, false)).toBeNull();
    expect(pinPrompt({ kind: 'required', set: true }, false)).toBe('set');
    expect(pinPrompt({ kind: 'required', set: true }, true)).toBe('confirm');
    expect(pinPrompt({ kind: 'invalid' }, false)).toBe('set');
    expect(pinPrompt({ kind: 'required', set: false }, false)).toBe('enter');
    expect(pinPrompt({ kind: 'wrong', left: 2 }, false)).toBe('enter');
    expect(pinPrompt({ kind: 'locked' }, false)).toBe('locked');
  });
});
