import { useTitle } from '../lib/session';
import { t } from '../lib/copy';
import { Link, useParams } from 'react-router';
import { useApi } from '../lib/use-api';
import { useQueryParams } from '../lib/use-query-params';
import {
  ErrorBanner,
  PageHeader,
  CONTROL,
  BUTTON_SM,
  PaginationBar,
  TableShell,
} from '../components/console';

type Team = { id: string; name: string; createdAt: string };
type Page = { teams: Team[]; total: number; page: number; totalPages: number };
export function TeamsPage() {
  useTitle(t('teams'));
  const { params, set, href } = useQueryParams<{ q?: string; page?: string }>();
  const { data, error } = useApi<Page>('/api/admin/teams', params);
  return (
    <div>
      <PageHeader
        title={t('teams')}
        description={t('findATeamByNameIdOrMemberEmail')}
      />
      <input
        className={CONTROL + ' mb-4 w-full max-w-md'}
        aria-label={t('searchTeams')}
        placeholder={t('nameIdOrMemberEmail')}
        defaultValue={params.q ?? ''}
        onChange={(e) => set({ q: e.target.value }, { mode: 'replace' })}
      />
      <ErrorBanner error={error} />
      {data && (
        <>
          <TableShell>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="p-3 text-left">{t('team')}</th>
                  <th className="p-3 text-left">{t('id')}</th>
                  <th className="p-3 text-left">{t('created')}</th>
                </tr>
              </thead>
              <tbody>
                {data.teams.map((t) => (
                  <tr key={t.id} className="border-t">
                    <td className="p-3">
                      <Link className="underline" to={'/teams/' + t.id}>
                        {t.name}
                      </Link>
                    </td>
                    <td className="p-3 font-mono">{t.id}</td>
                    <td className="p-3">{t.createdAt.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
          <PaginationBar {...data} noun="teams">
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
export function TeamPage() {
  useTitle(t('team'));
  const { id } = useParams();
  const { params, href } = useQueryParams<{ page?: string }>();
  const { data, error } = useApi<
    Team & {
      members: {
        id: string;
        email: string;
        name: string | null;
        role: string;
      }[];
      total: number;
      page: number;
      totalPages: number;
    }
  >('/api/admin/teams/' + encodeURIComponent(id ?? ''), params);
  return (
    <div>
      <PageHeader title={data?.name ?? t('team')} description={id ?? ''} />
      <ErrorBanner error={error} />
      {data && (
        <>
          <TableShell>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="p-3 text-left">{t('email')}</th>
                  <th className="p-3 text-left">{t('name')}</th>
                  <th className="p-3 text-left">{t('role')}</th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((m) => (
                  <tr key={m.id} className="border-t">
                    <td className="p-3">{m.email}</td>
                    <td className="p-3">{m.name}</td>
                    <td className="p-3">{m.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
          <PaginationBar {...data} noun="members">
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
export function SystemPage() {
  useTitle(t('system'));
  const { data, error } = useApi<{
    serviceRole: string;
    database: string;
    google: boolean;
    email: boolean;
    automation: boolean;
    privateProviders: boolean;
  }>('/api/admin/system');
  return (
    <div>
      <PageHeader
        title={t('system')}
        description={t('configurationStatusSecretsAreNeverReturned')}
      />
      <ErrorBanner error={error} />
      {data && (
        <dl className="max-w-xl divide-y rounded-xl border p-5">
          {Object.entries(data).map(([key, value]) => (
            <div className="flex justify-between gap-4 py-3" key={key}>
              <dt>
                {t(
                  key === 'email'
                    ? 'emailSignIn'
                    : (key as
                        | 'serviceRole'
                        | 'database'
                        | 'google'
                        | 'automation'
                        | 'privateProviders'),
                )}
              </dt>
              <dd>
                {typeof value === 'boolean'
                  ? value
                    ? t('enabled')
                    : t('disabled')
                  : value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
