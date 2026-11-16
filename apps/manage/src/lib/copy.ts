import { matchLocale } from '@dsh-teamwork/shared';
import en from '../messages/en.json';
import zh from '../messages/zh-CN.json';
const cookie = typeof document === 'undefined' ? '' : document.cookie;
const chosen = /(?:^|;\s*)locale=([^;]+)/.exec(cookie)?.[1];
let preference = '';
try {
  preference = chosen ? decodeURIComponent(chosen) : '';
} catch {
  /* Ignore malformed cookies. */
}
const locale = matchLocale([
  preference,
  ...(globalThis.navigator?.languages ?? []),
]);
export const t = (key: keyof typeof en) => (locale === 'zh-CN' ? zh : en)[key];
