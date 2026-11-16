import { t } from '../lib/copy';
import { Link } from 'react-router';
import { toast } from 'sonner';

import {
  BUTTON_SM,
  CONTROL,
  EmptyState,
  ErrorBanner,
  PageHeader,
  PaginationBar,
  TableShell,
} from '../components/console';
import type { AdminUsersPage } from '../lib/types';
import { api } from '../lib/api-client';
import { useTitle } from '../lib/session';
import { useApi } from '../lib/use-api';
import { useQueryParams } from '../lib/use-query-params';

export function UsersPage() {
  useTitle(t('users'));
  const { params, set, href } = useQueryParams<{ q?: string; page?: string }>();
  const { data, error, loading, refetch } = useApi<AdminUsersPage>(
    '/api/admin/users',
    {
      q: params.q,
      page: params.page,
    },
  );

  async function rename(id: string, current: string | null) {
    const name = window.prompt(t('displayNameEmptyToClear'), current ?? '');
    if (name === null) return;
    try {
      await api.patch(`/api/admin/users/${id}`, { name: name.trim() || null });
      toast.success(t('nameUpdated'));
      refetch();
    } catch (e) {
      toast.error(
        `Could not update: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return (
    <div>
      <PageHeader
        title={t('users')}
        description={t('everyoneWhoHasSignedInNewestFirst')}
      />
      <input
        className={`${CONTROL} mb-4 w-full max-w-sm`}
        placeholder={t('searchEmailOrName')}
        defaultValue={params.q ?? ''}
        onChange={(event) =>
          set({ q: event.target.value }, { mode: 'replace' })
        }
      />
      <ErrorBanner error={error} />
      {!data || data.users.length === 0 ? (
        <EmptyState
          loading={loading}
          message={params.q ? t('noUserMatchesThatSearch') : t('noUsersYet')}
        />
      ) : (
        <>
          <TableShell>
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">{t('email')}</th>
                  <th className="px-4 py-2 font-medium">{t('name')}</th>
                  <th className="px-4 py-2 font-medium">{t('language')}</th>
                  <th className="px-4 py-2 font-medium">{t('joined')}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {data.users.map((user) => (
                  <tr key={user.id} className="border-t border-border">
                    <td className="px-4 py-2">{user.email}</td>
                    <td className="px-4 py-2">
                      {user.name ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {user.locale ?? 'auto'}
                    </td>
                    <td className="tabular px-4 py-2 text-muted-foreground">
                      {user.createdAt.slice(0, 10)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        className={BUTTON_SM}
                        onClick={() => rename(user.id, user.name)}
                      >
                        {t('rename')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
          <PaginationBar
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            noun="users"
          >
            {data.page > 1 && (
              <Link className={BUTTON_SM} to={href({ page: data.page - 1 })}>
                {t('previous')}
              </Link>
            )}
            {data.page < data.totalPages && (
              <Link className={BUTTON_SM} to={href({ page: data.page + 1 })}>
                {t('next')}
              </Link>
            )}
          </PaginationBar>
        </>
      )}
    </div>
  );
}
