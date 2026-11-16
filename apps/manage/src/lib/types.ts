/** What /api/admin answers (premium/server/manage/routes.go, whose index renders the same). */

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  locale: string | null;
  /** ISO 8601, UTC */
  createdAt: string;
}

export interface AdminUsersPage {
  users: AdminUserRow[];
  total: number;
  page: number;
  totalPages: number;
}

export interface AdminStats {
  teams: number;
  users: number;
  newInWeek: number;
}
