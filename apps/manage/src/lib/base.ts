export let adminBase = '/manage';
export let googleOnly = false;
export function configureBase(base: string, google = false) {
  adminBase = base;
  googleOnly = google;
}
export function adminPath(path = '/') {
  return adminBase + path;
}
