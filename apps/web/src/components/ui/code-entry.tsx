/**
 * Typing a short code: a computer's PIN and a pairing code, drawn as the phone app draws them (its `pin-gate.tsx` and
 * `pair.tsx`) so the two clients read as one. A prompt is an icon on a tile, a title and a line under it; the code is
 * one slot per character over a single invisible field, so typing, pasting, autofill and a screen reader all meet an
 * ordinary input.
 */

import type { LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** The head of a code prompt: the icon on its tile, the title and what to type, then the rest of the prompt. */
export function CodePrompt({ icon: Icon, title, hint, children }: { icon: LucideIcon; title: string; hint: ReactNode; children?: ReactNode }) {
  return (
    <section className="m-auto flex w-full max-w-sm flex-col items-center gap-5 px-4 py-10 text-center">
      <span className="grid size-16 place-items-center rounded-2xl bg-secondary">
        <Icon className="size-7" aria-hidden />
      </span>
      <div className="flex flex-col gap-2">
        <h3 className="text-xl font-semibold tracking-tight [overflow-wrap:anywhere]">{title}</h3>
        <p className="text-sm leading-6 text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  );
}

/**
 * One slot per character. `secret` draws rings that fill with a dot, as a PIN pad does; otherwise each slot is a box
 * holding its character, with a dash after `group` characters where the computer shows the code with a space. The
 * next slot to fill is outlined while the field has focus. `onChange` gets the field's raw text to clean and cut.
 */
export function CodeSlots({ label, length, value, secret = false, group, disabled, onChange }: { label: string; length: number; value: string; secret?: boolean; group?: number; disabled?: boolean; onChange(raw: string): void }) {
  const [focused, setFocused] = useState(false);
  const next = Math.min(value.length, length - 1);
  return (
    <div className={cn('relative flex items-center justify-center', secret ? 'gap-4' : 'gap-2', disabled && 'opacity-60')}>
      {Array.from({ length }, (_, i) => {
        const active = focused && !disabled && i === next;
        return (
          <span key={i} className="contents">
            {group !== undefined && i === group && <span className="h-0.5 w-3 shrink-0 rounded-full bg-border" aria-hidden />}
            {secret ? (
              <span className={cn('grid size-14 place-items-center rounded-full border-2 transition-colors', active ? 'border-foreground' : 'border-input')} aria-hidden>
                {i < value.length && <span className="size-3.5 rounded-full bg-foreground" />}
              </span>
            ) : (
              <span
                className={cn(
                  'grid h-14 w-11 place-items-center rounded-xl border bg-card font-mono text-2xl font-semibold uppercase shadow-xs transition-colors',
                  active ? 'border-foreground' : 'border-input',
                )}
                aria-hidden
              >
                {value[i] ?? (active && <span className="h-6 w-0.5 animate-pulse rounded-full bg-foreground" />)}
              </span>
            )}
          </span>
        );
      })}
      <input
        aria-label={label}
        type={secret ? 'password' : 'text'}
        inputMode={secret ? 'numeric' : 'text'}
        autoComplete={secret ? 'off' : 'one-time-code'}
        autoCapitalize={secret ? undefined : 'characters'}
        spellCheck={false}
        autoFocus
        // Read-only rather than disabled while busy, so the field keeps its focus for the next try.
        readOnly={disabled}
        aria-busy={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // Over the slots, so a click anywhere on them focuses it; never drawn, so the slots are what the reader sees.
        className="absolute inset-0 size-full cursor-text opacity-0"
      />
    </div>
  );
}
