import { Check, ChevronDown } from 'lucide-react';
import { Select } from 'radix-ui';

import { Button } from '@/components/ui/button';

/** Custom, keyboard-accessible selection. Numeric internal keys permit an
 * empty domain value (such as All members) without Radix's empty-value trap. */
export function Choice({ label, value, options, change, id, disabled }: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  change: (value: string) => void;
  id?: string;
  disabled?: boolean;
}) {
  const selected = options.findIndex((option) => option.value === value);
  return (
    <Select.Root value={selected < 0 ? '' : String(selected)} disabled={disabled} onValueChange={(key) => {
      const option = options[Number(key)];
      if (option) change(option.value);
    }}>
      <Select.Trigger asChild>
        <Button id={id} type="button" variant="outline" aria-label={label} className="justify-between">
          <Select.Value placeholder={label} />
          <Select.Icon><ChevronDown className="size-4" /></Select.Icon>
        </Button>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content position="popper" sideOffset={5} className="z-50 min-w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          <Select.Viewport className="max-h-72 overflow-y-auto">
            {options.map((option, index) => (
              <Select.Item key={option.value} value={String(index)} className="relative cursor-pointer rounded-sm py-2 pr-7 pl-3 text-sm outline-none data-[highlighted]:bg-accent">
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator className="absolute right-2"><Check className="size-4" /></Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
