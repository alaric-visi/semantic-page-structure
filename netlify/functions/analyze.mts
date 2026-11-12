import type { Config, Context } from '@netlify/functions';
import { handleApiRequest } from '../../src/lib/api-handler';

export default async (req: Request, _context: Context): Promise<Response> => {
  return handleApiRequest(req);
};

export const config: Config = {
  path: [
    '/api/page-structure/analyze',
    '/api/analyze',
    '/api/keywords/volume',
    '/api/volume',
  ],
};
