/**
 * Test API Endpoint
 * Simple test to verify API routing is working
 */

import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.status(200).json({
    success: true,
    message: 'API is working!',
    method: req.method,
    timestamp: new Date().toISOString(),
    routes: {
      verify: '/api/verify',
      activate: '/api/activate',
      revoke: '/api/admin/revoke',
      initDb: '/api/init-db'
    }
  });
}