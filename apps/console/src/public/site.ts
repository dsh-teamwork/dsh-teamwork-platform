/**
 * The site's own address in a prerendered page. The binary is built once and
 * deployed anywhere, so the page carries this placeholder wherever it names
 * itself (canonical, Open Graph, JSON-LD), and the Go server writes APP_URL
 * over it when it serves the page (server/internal/web). Never the Host
 * header: a canonical built from a header is one a stranger can poison.
 */
export const SITE_ORIGIN = '%APP_URL%';
