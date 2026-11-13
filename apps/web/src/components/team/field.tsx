import type { ReactNode } from 'react';

import { Label } from '@/components/ui/label';

/** A labelled form control with an optional hint under it, as every console dialog lays one out. */
export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
