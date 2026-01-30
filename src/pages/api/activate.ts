/**
 * License Activation API Endpoint - Full Implementation
 * Handles license activation with Payhip verification and database storage
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { execute, query, queryOne } from '../../../lib/db';
import {
  calculateOfflineExpiry,
  generateActivationToken,
  getLicenseTypeFromKey,
} from '../../../lib/utils/license';
import { DEFAULT_PRODUCT_ID, PRODUCTS } from '../../config/products';

// Define activation response structure
interface ActivateResponse {
  success: boolean;
  message: string;
  license_info?: any;
  activation_token?: string;
  offline_expiry?: string;
  status?: string;
  endpoints?: any;
  example?: any;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ActivateResponse>,
) {
  // [SECURITY] 1. Add CORS headers for cross-origin requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle OPTIONS preflight request
  if (req.method === 'OPTIONS') {
    return res.status(200).json({
      success: true,
      message: 'CORS preflight successful',
      status: 'ready',
    });
  }

  // Handle GET request (for testing)
  if (req.method === 'GET') {
    return res.status(200).json({
      success: true,
      message: 'PhotoBatchPro License API',
      status: 'ready',
      endpoints: {
        activate: '/api/activate',
        verify: '/api/verify',
        revoke: '/api/admin/revoke',
      },
      example: {
        activate: {
          method: 'POST',
          data: {
            licenseKey: 'XXXX-XXXXX-XXXX',
            productId: 'photobatchpro',
            machineId: 'device-fingerprint',
          },
        },
      },
    });
  }

  // Handle POST request
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      message: 'Method not allowed',
    });
  }

  const { licenseKey, productId, machineId } = req.body;

  // [SECURITY] 2. Input Validation (Sanitization)
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

  // productId is optional - use default if not provided (for backward compatibility)
  if (productId && (typeof productId !== 'string' || !productId.trim())) {
    return res.status(400).json({
      success: false,
      message: 'Invalid product ID format',
    });
  }

  // Trim and limit length (pre-empt brute force with massive payloads)
  const cleanKey = licenseKey.trim();
  if (cleanKey.length > 50) {
    return res.status(400).json({
      success: false,
      message: 'Key too long',
    });
  }

  // Validate product ID if provided
  let selectedProduct;
  if (productId) {
    selectedProduct = PRODUCTS.find((p) => p.id === productId);
    if (!selectedProduct) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product ID',
      });
    }
  } else {
    // Use default product for backward compatibility
    selectedProduct = PRODUCTS.find((p) => p.id === DEFAULT_PRODUCT_ID);
    if (!selectedProduct) {
      // Fallback to first product if default not found
      const [firstProduct] = PRODUCTS; // Use array destructuring
      selectedProduct = firstProduct;
      if (!selectedProduct) {
        return res.status(500).json({
          success: false,
          message: 'No products configured',
        });
      }
    }
  }

  // Regex Check: Alphanumeric and dashes only (Prevent SQLi/Command Injection patterns)
  const keyPattern = /^[A-Z0-9-]+$/i;
  if (!keyPattern.test(cleanKey)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid characters in key',
    });
  }

  // [SECURITY] Configuration Check
  const { PAYHIP_API_KEY } = process.env;
  if (!PAYHIP_API_KEY) {
    console.error('SERVER ERROR: Payhip API Key not set.');
    return res.status(500).json({
      success: false,
      message: 'Server configuration error',
    });
  }

  try {
    // Step 1: Payhip Verification (Layer 1: Confirm key is authentic)
    const productKey = selectedProduct.payhipProductId;

    const apiUrl = `https://payhip.com/api/v1/license/verify?product_link=${encodeURIComponent(
      productKey,
    )}&license_key=${encodeURIComponent(cleanKey)}`;

    const payhipRes = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'payhip-api-key': PAYHIP_API_KEY,
        'User-Agent': `${selectedProduct.name}-Activator/1.0`,
      },
    });

    const data = await payhipRes.json();

    // Payhip API response format: data.data.enabled === true means valid
    const isSuccess =
      data.success === true || (data.data && data.data.enabled === true);

    if (!isSuccess) {
      // Payhip validation failed
      return res.status(200).json({
        success: false,
        message:
          data.message ||
          `License not found or invalid for ${selectedProduct.name}`,
      });
    }

    // Step 2: Database Checks (Layer 2: Our control)
    const productIdToUse = selectedProduct.id;

    // Check 2.1: Is license refunded?
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
      return res.status(200).json({
        success: false,
        message: `License revoked: ${refunded.reason || 'REFUND'}. Please purchase a new license.`,
      });
    }

    // Check 2.2: Device activation limit
    const existingActivations = await query(
      `
      SELECT * FROM activations
      WHERE license_key = $1
      AND status = 'active'
      `,
      [cleanKey],
    );

    const maxActivations = parseInt(
      process.env.MAX_ACTIVATIONS_PER_LICENSE || '3',
      10,
    );
    if (existingActivations.length >= maxActivations) {
      // Check if this machine is already registered
      const machineActivation = existingActivations.find(
        (a: any) => a.machine_id === machineId,
      );
      if (!machineActivation) {
        return res.status(200).json({
          success: false,
          message: `Maximum activations reached (${maxActivations}). Please deactivate on another device or contact support.`,
        });
      }
    }

    // Step 3: Record activation in database
    const activationExists = await queryOne(
      'SELECT * FROM activations WHERE license_key = $1 AND machine_id = $2',
      [cleanKey, machineId],
    );

    if (activationExists) {
      // Update existing activation
      await execute(
        `
        UPDATE activations
        SET last_verified_at = CURRENT_TIMESTAMP,
            customer_email = $1,
            status = 'active'
        WHERE license_key = $2 AND machine_id = $3
        `,
        [data.data?.customer_email || '', cleanKey, machineId],
      );
    } else {
      // Create new activation record
      await execute(
        `
        INSERT INTO activations (
          license_key,
          product_id,
          machine_id,
          customer_email,
          activated_at,
          last_verified_at,
          status
        ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'active')
        `,
        [cleanKey, productIdToUse, machineId, data.data?.customer_email || ''],
      );
    }

    // Step 4: Generate activation token and return success response
    const licenseType = getLicenseTypeFromKey(cleanKey, productIdToUse);

    // Calculate offline grace period
    const expiryDays = parseInt(
      process.env.OFFLINE_GRACE_PERIOD_DAYS || '30',
      10,
    );
    const offlineExpiryDate = calculateOfflineExpiry(expiryDays);

    // Generate activation token for offline validation
    const activationToken = generateActivationToken(
      cleanKey,
      machineId,
      productIdToUse,
      expiryDays,
    );

    return res.status(200).json({
      success: true,
      message: `${selectedProduct.name} license activated successfully`,
      license_info: {
        license_type: licenseType,
        product_id: productIdToUse,
        expiry_date: null, // Permanent license
        features: ['full_access'], // Granted features based on license type
      },
      activation_token: activationToken,
      offline_expiry: offlineExpiryDate,
    });
  } catch (error) {
    console.error('[Activate] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Activation failed internal error',
    });
  }
}
