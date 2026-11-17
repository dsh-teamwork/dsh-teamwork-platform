import { describe, expect, it } from 'vitest';

import { replacing } from '@/lib/edition';

describe('an edition replacing pages', () => {
  it('drops an open route at the same path, at any depth, and keeps the rest', () => {
    const open = [
      { path: '/', id: 'home' },
      { id: 'signed-in', children: [{ path: '/account', id: 'account' }, { path: '/teams', id: 'teams' }] },
    ];
    const routes = replacing(open, [{ path: '/account', id: 'edition account' }, { path: '/pricing', id: 'pricing' }]);
    expect(routes.map((r) => r.id)).toEqual(['home', 'signed-in', 'edition account', 'pricing']);
    expect(routes[1].children?.map((r) => r.id)).toEqual(['teams']);
  });

  it('changes nothing when it adds only new paths', () => {
    const open = [{ path: 'models', id: 'models' }, { index: true, id: 'overview' }];
    expect(replacing(open, [{ path: 'billing', id: 'billing' }]).map((r) => r.id)).toEqual(['models', 'overview', 'billing']);
  });
});
