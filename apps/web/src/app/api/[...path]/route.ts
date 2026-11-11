/**
 * Every /api address no route claims. Next's own 404 is an HTML page; a client
 * of this API parses `{ error }`, so an unknown path answers in that shape.
 * A more specific route always wins over this one.
 */

import { apiError } from '@/lib/api';

const notFound = () => apiError(404, 'not_found');

export { notFound as GET, notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE };
