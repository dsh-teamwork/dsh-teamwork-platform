import { describe, expect, it } from 'vitest';

import { isNavItemActive, NAV_GROUPS, type NavItem } from '../nav';

const items = NAV_GROUPS.flatMap((group) => group.items);

function lit(url: string): NavItem[] {
  const { pathname, searchParams } = new URL(url, 'http://console');
  return items.filter((item) => isNavItemActive(item, pathname, searchParams));
}

describe('isNavItemActive', () => {
  it.each(['/', '/users', '/users/abc', '/users?q=ada&page=2'])(
    'lights exactly one row on %s',
    (url) => {
      expect(lit(url)).toHaveLength(1);
    },
  );

  it('does not light the dashboard on every page just because every path starts with /', () => {
    expect(lit('/users').map((item) => item.label)).toEqual(['Users']);
  });
});
