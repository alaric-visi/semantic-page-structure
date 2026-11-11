import type { Config, Context } from '@netlify/functions';
import { handleAnalyzeRequest } from '../../src/lib/api-handler';

export default async (req: Request, _context: Context): Promise<Response> => {
  return handleAnalyzeRequest(req);
};

export const config: Config = {
  path: ['/api/page-structure/analyze', '/api/analyze'],
};
