/**
 * A preset's avatar, drawn from the library both clients share
 * (`@dsh-teamwork/shared`, avatars.ts), and the picker the preset editor
 * chooses one with. Sized by `className` like an icon.
 */

import { PRESET_AVATAR_STYLE as STYLE, PRESET_AVATARS, presetAvatar, presetAvatarColor } from '@dsh-teamwork/shared';

import { cn } from '@/lib/utils';

/** The avatar `avatar` names, or the one the preset's `name` picks when it names none this console knows. */
export function PresetAvatar({ avatar, name, className }: { avatar?: string | null; name: string; className?: string }) {
  const shown = presetAvatar(avatar, name);
  return (
    <svg viewBox={`0 0 ${STYLE.size} ${STYLE.size}`} aria-hidden className={cn('size-8 shrink-0', className)}>
      <rect width={STYLE.size} height={STYLE.size} rx={STYLE.radius} fill={shown.plate} />
      {shown.layers.map((layer, i) => (
        <path
          key={i}
          d={layer.d}
          fill={layer.fill ? presetAvatarColor(shown, layer.fill) : 'none'}
          stroke={layer.stroke ? presetAvatarColor(shown, layer.stroke) : undefined}
          strokeWidth={layer.width ?? 1}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

/** One avatar from the whole library, as a radio group; `nameOf` words each for a screen reader. */
export function PresetAvatarPicker({ value, label, nameOf, onChange }: { value: string; label: string; nameOf: (id: string) => string; onChange: (id: string) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {PRESET_AVATARS.map((avatar) => (
        <button
          key={avatar.id}
          type="button"
          role="radio"
          aria-checked={value === avatar.id}
          aria-label={nameOf(avatar.id)}
          title={nameOf(avatar.id)}
          onClick={() => onChange(avatar.id)}
          className={cn('rounded-lg p-0.5 ring-offset-background', value === avatar.id ? 'ring-2 ring-foreground ring-offset-1' : 'opacity-70 hover:opacity-100')}
        >
          <PresetAvatar avatar={avatar.id} name="" className="size-9" />
        </button>
      ))}
    </div>
  );
}
