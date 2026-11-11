import * as React from 'react';

import { cn } from '@/lib/utils';

/** A native `<select>` in the input's dress: keyboard and screen-reader behaviour come from the browser. */
export function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
