/**
 * License Activation API Endpoint
 * CORS Fix and Redirect Handling
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
  customerEmail?: string;
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
  // Handle trailing slash and redirects properly
  if (req.method === 'GET') {
    return res.status(200).json({
      message: 'POST method required for license activation',
      endpoint: '/api/activate',
      method: 'POST',
      example: {
        licenseKey: "XXXX-XXXXX-XXXX",
        productId: "photobatchpro",
        machineId: "device-fingerprint"
      }
    });
  }

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).setHeader('Access-Control-Allow-Origin', '*')
                  .setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
                  .setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
                  .json({});
  }

  // Security: Only POST requests allowed
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      message: 'Method not allowed',
    });
  }

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

  // Trim and limit length
  const cleanKey = licenseKey.trim();
  if (cleanKey.length > 50) {
    return res.status(400).json({
      success: false,
      message: 'Key too long',
    });
  }

  // Validate license key format
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

  // Configuration check
  const { PAYHIP_API_KEY } = process.env;
  if (!PAYHIP_API_KEY) {
    console.error('[Activate] PAYHIP_API_KEY not configured');
    return res.status(500).json({
      success: false,
      message: 'Server configuration error',
    });
  }

  try {
    // Step 2: Payhip Verification
    const productKey = selectedProduct.payhipProductId;

    const apiUrl = `https://payhip.com/api/v1/license/verify?product_link=${encodeURIComponent(
      productKey,
    )}&license_key=${encodeURIComponent(cleanKey)}`;

    console.log(`[Activate] Payhip API URL: ${apiUrl}`);

    const payhipRes = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'payhip-api-key': PAYHIP_API_KEY,
        'User-Agent': `${selectedProduct.name}-Activator/1.0`,
      },
    });

    const data = await payhipRes.json();

    // Check Payhip response
    const isSuccess = data.success === true || (data.data && data.data.enabled === true);

    if (!isSuccess) {
      console.log(`[Activate] Payhip failed: ${JSON.stringify(data)}`);
      return res.status(200).json({
        success: false,
        message: data.message || `License not found or invalid for ${selectedProduct.name}`,
        payhipDebug: data,
      });
    }

    // Step 3: Database checks
    // Check if license is refunded
    const refunded = await queryOne(
      `SELECT * FROM refunded_licenses WHERE license_key = $1 ORDER BY refunded_at DESC LIMIT 1`,
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

    // Check device limit (max 3 devices per license)
    const maxActivations = parseInt(process.env.MAX_ACTIVATIONS_PER_LICENSE || '3', 10);
    const activeActivations = await query(
      `SELECT * FROM activations WHERE license_key = $1 AND status = 'active'`,
      [cleanKey],
    );

    if (activeActivations.length >= maxActivations) {
      const existingMachineIds = activeActivations.map((a: any) => a.machine_id);
      
      // Check if this machine is already activated
      if (!existingMachineIds.includes(machineId)) {
        console.warn(`[Activate] Device limit exceeded for ${cleanKey}`);
        return res.status(403).json({
          success: false,
          message: `This license is already activated on ${maxActivations} device(s). Maximum is ${maxActivations}.`,
          error: 'DEVICE_LIMIT_EXCEEDED',
          current_activations: activeActivations.length,
        });
      }
    }

    // Step 4: Check if this machine is already activated
    const existingActivation = await queryOne(
      `SELECT * FROM activations WHERE license_key = $1 AND machine_id = $2`,
      [cleanKey, machineId],
    );

    const offlineGracePeriodDays = parseInt(process.env.OFFLINE_GRACE_PERIOD_DAYS || '30', 10);

    if (existingActivation) {
      // Re-activation on same device - just refresh timestamps
      console.log(`[Activate] Re-activating existing key on device: ${machineId}`);
      
      await execute(
        `UPDATE activations 
         SET last_verified_at = CURRENT_TIMESTAMP,
             offline_expiry = CURRENT_TIMESTAMP + INTERVAL '${offlineGracePeriodDays} days',
             status = 'active'
         WHERE id = $1`,
        [existingActivation.id],
      );
    } else {
      // New device activation
      console.log(`[Activate] New activation on device: ${machineId}`);

      const activationData = {
        license_key: cleanKey,
        product_id: productIdToUse,
        machine_id: machineId,
        customer_email: data.data?.customer_email || null,
        offline_expiry: calculateOfflineExpiry(offlineGracePeriodDays),
        user_agent: req.headers['user-agent'] || null,
        ip_address: req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || null,
      };

      await execute(
        `INSERT INTO activations (
          license_key, product_id, machine_id, customer_email, 
          offline_expiry, user_agent, ip_address
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          activationData.license_key,
          activationData.product_id,
          activationData.machine_id,
          activationData.customer_email,
          activationData.offline_expiry,
          activationData.user_agent,
          activationData.ip_address,
        ],
      );
    }

    // Step 5: Generate activation token and response
    const licenseInfo = getLicenseInfoFromKey(cleanKey, productIdToUse);
    const activationToken = generateActivationToken(
      cleanKey,
      machineId,
      productIdToUse,
      offlineGracePeriodDays,
    );

    console.log(`[Activate] Activation successful for ${cleanKey}`);

    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    return res.status(200).json({
      success: true,
      message: 'License activated successfully',
      license_info: licenseInfo,
      activation_token: activationToken,
      offline_expiry: calculateOfflineExpiry(offlineGracePeriodDays),
    });

  } catch (error: {
    console.error('[Activate] Error:', error);
    
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    return res.status(500).json({
      success: false,
      message: 'Activation failed due to server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
}