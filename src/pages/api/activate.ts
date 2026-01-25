/**
 * License Activation API Endpoint
 * Handles first-time license activation with device binding
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { DEFAULT_PRODUCT_ID, PRODUCTS } from '../../config/products';
import { query, queryOne, execute } from '../../../lib/db';
import {
  generateActivationToken,
  getLicenseInfoFromKey,
  calculateOfflineExpiry,
  isValidLicenseKeyFormat,
} from '../../../lib/utils/license';

interface ActivateRequest {
  licenseKey: string;
  productId?: string;
  machineId: string;
  customerEmail?: string; // Optional: customer email from Payhip
}

interface ActivateResponse {
  success: boolean;
  message: string;
  license_info?: any;
  activation_token?: string;
  offline_expiry?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ActivateResponse>,
) {
  // Security: Only POST requests allowed
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      message: 'Method not allowed',
    });
  }

  try {
    const { licenseKey, productId, machineId } = req.body as ActivateRequest;

    // Step 1: Input validation
    if (!licenseKey || typeof licenseKey !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'License key is required',
      });
    }

    if (!machineId || typeof machineId !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Machine ID is required',
      });
    }

    const cleanKey = licenseKey.trim().toUpperCase();

    if (!isValidLicenseKeyFormat(cleanKey)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid license key format',
      });
    }

    // Get product configuration
    const productIdToUse = productId || DEFAULT_PRODUCT_ID;
    const selectedProduct = PRODUCTS.find((p) => p.id === productIdToUse);

    if (!selectedProduct) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product ID',
      });
    }

    // Step 2: Payhip Verification (Layer 1)
    const { PAYHIP_API_KEY } = process.env;
    if (!PAYHIP_API_KEY) {
      console.error('[Activate] PAYHIP_API_KEY not configured');
      return res.status(500).json({
        success: false,
        message: 'Server configuration error',
      });
    }

    const payhipRes = await fetch(
      `https://payhip.com/api/v1/license/verify?product_link=${encodeURIComponent(
        selectedProduct.payhipProductId,
      )}&license_key=${encodeURIComponent(cleanKey)}`,
      {
        headers: {
          'payhip-api-key': PAYHIP_API_KEY,
          'User-Agent': `${selectedProduct.name}-Activator/1.0`,
        },
      },
    );

    const payhipData = await payhipRes.json();
    const isPayhipValid =
      payhipData.success === true ||
      (payhipData.data && payhipData.data.enabled === true);

    if (!isPayhipValid) {
      console.warn(`[Activate] Invalid Payhip license: ${cleanKey}`);
      return res.status(400).json({
        success: false,
        message: payhipData.message || 'Invalid license key',
      });
    }

    // Step 3: Database Checks (Layer 2)

    // Check 3.1: Is license refunded?
    const refunded = await queryOne(
      `
      SELECT * FROM refunded_licenses
      WHERE license_key = $1
      ORDER BY refunded_at DESC
      LIMIT 1
      `,
      [cleanKey],
    );

    if (refunded) {
      console.warn(`[Activate] Refunded license attempted: ${cleanKey}`);
      return res.status(403).json({
        success: false,
        message: `License revoked: ${refunded.reason || 'REFUND'}. Please purchase a new license.`,
        error: 'LICENSE_REVOKED',
      });
    }

    // Check 3.2: Device limit check
    const maxActivations = parseInt(
      process.env.MAX_ACTIVATIONS_PER_LICENSE || '3',
      10,
    );

    const activeActivations = await query(
      `
      SELECT * FROM activations
      WHERE license_key = $1 AND status = 'active'
      `,
      [cleanKey],
    );

    if (activeActivations.length >= maxActivations) {
      const devices = activeActivations.map((a: any) => ({
        machineId: a.machine_id,
        activatedAt: a.activated_at,
      }));

      console.warn(
        `[Activate] License ${cleanKey} already activated on ${activeActivations.length} devices`,
      );

      return res.status(403).json({
        success: false,
        message: `This license is already activated on ${activeActivations.length} device(s). Maximum is ${maxActivations}.`,
        error: 'DEVICE_LIMIT_EXCEEDED',
        devices,
      });
    }

    // Step 4: Check if this machine is already activated
    const existingActivation = await queryOne(
      `
      SELECT * FROM activations
      WHERE license_key = $1 AND machine_id = $2
      `,
      [cleanKey, machineId],
    );

    const offlineGracePeriodDays = parseInt(
      process.env.OFFLINE_GRACE_PERIOD_DAYS || '30',
      10,
    );

    let activationId;

    if (existingActivation) {
      // Re-activation on same device: just refresh timestamps
      console.log(`[Activate] Re-activating existing key on device: ${machineId}`);

      await execute(
        `
        UPDATE activations
        SET last_verified_at = CURRENT_TIMESTAMP,
            offline_expiry = CURRENT_TIMESTAMP + INTERVAL '${offlineGracePeriodDays} days',
            status = 'active'
        WHERE id = $1
        `,
        [existingActivation.id],
      );

      activationId = existingActivation.id;
    } else {
      // New device activation
      console.log(`[Activate] New activation on device: ${machineId}`);

      const expiry = calculateOfflineExpiry(offlineGracePeriodDays);

      const result = await query(
        `
        INSERT INTO activations (
          license_key,
          product_id,
          machine_id,
          customer_email,
          offline_expiry,
          user_agent,
          ip_address
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
        `,
        [
          cleanKey,
          productIdToUse,
          machineId,
          payhipData.data?.customer_email || null,
          new Date(expiry),
          req.headers['user-agent'] || null,
          req.headers['x-forwarded-for'] ||
            req.headers['x-real-ip'] ||
            req.socket.remoteAddress ||
            null,
        ],
      );

      activationId = result[0]?.id;
    }

    // Step 5: Generate activation token and license info
    const activationToken = generateActivationToken(
      cleanKey,
      machineId,
      productIdToUse,
      offlineGracePeriodDays,
    );

    const licenseInfo = getLicenseInfoFromKey(cleanKey, productIdToUse);

    console.log(`[Activate] Success: ${cleanKey} on ${machineId} (${activationId})`);

    return res.status(200).json({
      success: true,
      message: 'License activated successfully',
      license_info: licenseInfo,
      activation_token: activationToken,
      offline_expiry: calculateOfflineExpiry(offlineGracePeriodDays),
    });
  } catch (error: any) {
    console.error('[Activate] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Activation failed due to server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
}
