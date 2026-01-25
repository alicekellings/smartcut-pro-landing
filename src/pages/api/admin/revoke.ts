/**
 * Revoke License API Endpoint (Admin)
 * Admin endpoint to revoke/refund a license
 *
 * POST /api/admin/revoke
 *
 * Simple authentication: requires a secret key in the Authorization header or query param
 * For production, implement proper admin authentication (JWT, session, etc.)
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { query, execute } from '../../../lib/db.ts';

interface RevokeRequest {
  licenseKey: string;
  reason: string;
  email?: string;
  secret?: string; // Admin secret
}

interface RevokeResponse {
  success: boolean;
  message: string;
  data?: {
    license_key: string;
    revoked_at: string;
    activations_cancelled: number;
  };
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RevokeResponse>,
) {
  // Only POST requests allowed
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      message: 'Method not allowed',
    });
  }

  try {
    const { licenseKey, reason, email, secret } = req.body as RevokeRequest;

    // Simple authentication: check secret
    const adminSecret = secret || req.query.secret;
    const requiredSecret = process.env.ADMIN_SECRET || process.env.JWT_SECRET;

    if (!adminSecret || adminSecret !== requiredSecret) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Invalid admin secret',
      });
    }

    // Input validation
    if (!licenseKey || typeof licenseKey !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'License key is required',
      });
    }

    if (!reason || typeof reason !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Reason is required',
      });
    }

    const cleanKey = licenseKey.trim().toUpperCase();

    console.log(`[Admin Revoke] Revoking license: ${cleanKey}, Reason: ${reason}`);

    // Step 1: Check if already refunded
    const existingRefund = await query(
      `
      SELECT * FROM refunded_licenses
      WHERE license_key = $1
      `,
      [cleanKey],
    );

    if (existingRefund.length > 0) {
      console.warn(`[Admin Revoke] License already refunded: ${cleanKey}`);
      return res.status(200).json({
        success: false,
        message: 'License is already revoked/refunded',
      });
    }

    // Step 2: Add to refunded licenses table
    await execute(
      `
      INSERT INTO refunded_licenses (license_key, email, reason)
      VALUES ($1, $2, $3)
      `,
      [cleanKey, email || null, reason],
    );

    // Step 3: Cancel all activations
    const updateResult = await execute(
      `
      UPDATE activations
      SET status = 'revoked',
          last_verified_at = CURRENT_TIMESTAMP
      WHERE license_key = $1 AND status = 'active'
      `,
      [cleanKey],
    );

    const activationsCancelled = updateResult;

    console.log(
      `[Admin Revoke] License ${cleanKey} revoked, ${activationsCancelled} activation(s) cancelled`,
    );

    // Log the IP that performed the revocation
    console.log(
      `[Admin Revoke] Performed by IP: ${req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket.remoteAddress}`,
    );

    return res.status(200).json({
      success: true,
      message: 'License revoked successfully',
      data: {
        license_key: cleanKey,
        revoked_at: new Date().toISOString(),
        activations_cancelled: activationsCancelled,
      },
    });
  } catch (error: any) {
    console.error('[Admin Revoke] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to revoke license',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
}
