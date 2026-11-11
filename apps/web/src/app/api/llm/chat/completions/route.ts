// The model gateway's one endpoint: OpenAI Chat Completions, `model` being a team configuration id.
import { handleRouteError, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { proxyCompletion } from '@/lib/llm-gateway';

/** A long conversation with tool results is far larger than an ordinary JSON body. */
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    return await proxyCompletion(user.id, await readJson(request, MAX_BYTES), request.signal);
  } catch (error) {
    return handleRouteError(error, 'POST /api/llm/chat/completions');
  }
}
