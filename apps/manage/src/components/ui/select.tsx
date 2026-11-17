import { Check, ChevronDown } from 'lucide-react';
import { Select as Primitive } from 'radix-ui';

import { Button } from './button';
import { cn } from '../../lib/utils';

/**
 * The one way to pick from a list in the operator console, the member
 * console's own: a trigger in the outline button's dress and a menu on the
 * card surface, keyboard-accessible (Radix). Options are addressed by their position, so an empty value (such as
 * "All members") is an ordinary choice rather than Radix's reserved "nothing".
 * An edition's pages import it from `@dsh-teamwork/manage` rather than
 * drawing a native select.
 */
export function Select({ label, value, options, change, id, disabled, className }: {
  /** Names the control for assistive technology, and shows while nothing is chosen. */
  label: string;
  value: string;
  options: { value: string; label: string }[];
  change: (value: string) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
}) {
  const selected = options.findIndex((option) => option.value === value);
  return (
    <Primitive.Root value={selected < 0 ? '' : String(selected)} disabled={disabled} onValueChange={(key) => {
      const option = options[Number(key)];
      if (option) change(option.value);
    }}>
      <Primitive.Trigger asChild>
        <Button id={id} type="button" variant="outline" aria-label={label} className={cn('min-w-0 justify-between font-normal', className)}>
          <span className="truncate"><Primitive.Value placeholder={label} /></span>
          <Primitive.Icon><ChevronDown className="size-4 text-muted-foreground" /></Primitive.Icon>
        </Button>
      </Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content position="popper" sideOffset={5} className="z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) rounded-lg border bg-card p-1 text-card-foreground shadow-lg">
          <Primitive.Viewport className="max-h-72 overflow-y-auto">
            {options.map((option, index) => (
              <Primitive.Item key={`${index}:${option.value}`} value={String(index)} className="relative cursor-pointer rounded-md py-1.5 pr-8 pl-2.5 text-sm outline-none data-[highlighted]:bg-accent">
                <Primitive.ItemText>{option.label}</Primitive.ItemText>
                <Primitive.ItemIndicator className="absolute top-1/2 right-2 -translate-y-1/2"><Check className="size-4" /></Primitive.ItemIndicator>
              </Primitive.Item>
            ))}
          </Primitive.Viewport>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
