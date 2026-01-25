import type { NextApiRequest, NextApiResponse } from 'next';

import { DEFAULT_PRODUCT_ID, PRODUCTS } from '../../config/products';
import { queryOne } from '../../../lib/db';
import { verifyActivationToken, getLicenseTypeFromKey, calculateOfflineExpiry } from '../../../lib/utils/license';

// Define verify response structure
interface VerifyResponse {
  valid: boolean;
  licenseMsg: string; // Used by desktop app
  message?: string; // Optional fallback
  email?: string;
  payhipDebug?: any;
  license_info?: any;
  offline_expiry?: string;
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<VerifyResponse>,
) {
  // [SECURITY] 1. Allow only POST requests
  if (req.method !== 'POST') {
    return res
      .status(405)
      .json({ valid: false, licenseMsg: 'Method Not Allowed' });
  }

  const { licenseKey, productId } = req.body;

  // [SECURITY] 2. Input Validation (Sanitization)
  if (!licenseKey || typeof licenseKey !== 'string') {
    return res
      .status(400)
      .json({ valid: false, licenseMsg: 'Missing or invalid key format' });
  }

  // productId is optional - use default if not provided (for backward compatibility)
  if (productId && (typeof productId !== 'string' || !productId.trim())) {
    return res
      .status(400)
      .json({ valid: false, licenseMsg: 'Invalid product ID format' });
  }

  // Trim and limit length (pre-empt brute force with massive payloads)
  const cleanKey = licenseKey.trim();
  if (cleanKey.length > 50) {
    return res.status(400).json({ valid: false, licenseMsg: 'Key too long' });
  }

  // Validate product ID if provided
  let selectedProduct;
  if (productId) {
    selectedProduct = PRODUCTS.find((p) => p.id === productId);
    if (!selectedProduct) {
      return res
        .status(400)
        .json({ valid: false, licenseMsg: 'Invalid product ID' });
    }
  } else {
    // Use default product for backward compatibility
    selectedProduct = PRODUCTS.find((p) => p.id === DEFAULT_PRODUCT_ID);
    if (!selectedProduct) {
      // Fallback to first product if default not found
      const [firstProduct] = PRODUCTS; // Use array destructuring
      selectedProduct = firstProduct;
      if (!selectedProduct) {
        return res
          .status(500)
          .json({ valid: false, licenseMsg: 'No products configured' });
      }
    }
  }

  // Regex Check: Alphanumeric and dashes only (Prevent SQLi/Command Injection patterns)
  const keyPattern = /^[A-Z0-9-]+$/i;
  if (!keyPattern.test(cleanKey)) {
    return res
      .status(400)
      .json({ valid: false, licenseMsg: 'Invalid characters in key' });
  }

  // [SECURITY] Configuration Check
  const { PAYHIP_API_KEY } = process.env;
  if (!PAYHIP_API_KEY) {
    console.error('SERVER ERROR: Payhip API Key not set.');
    return res
      .status(500)
      .json({ valid: false, licenseMsg: 'Server configuration error' });
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
        'User-Agent': `${selectedProduct.name}-Verifier/1.0`,
      },
    });

    const data = await payhipRes.json();

    // Payhip API response format: data.data.enabled === true means valid
    const isSuccess =
      data.success === true || (data.data && data.data.enabled === true);

    if (!isSuccess) {
      // Payhip validation failed
      return res.status(200).json({
        valid: false,
        licenseMsg:
          data.message ||
          `License not found or invalid for ${selectedProduct.name}`,
        payhipDebug: data,
      });
    }

    // Step 2: Database Checks (Layer 2: Our control)
    const productIdentifier = selectedProduct.id;

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
      console.warn(`[Verify] Refunded license attempted: ${cleanKey}`);
      return res.status(200).json({
        valid: false,
        licenseMsg: `License revoked: ${refunded.reason || 'REFUND'}. Please purchase a new license.`,
        error: 'LICENSE_REVOKED',
      });
    }

    // Step 3: Return successful response with license info
    const licenseType = getLicenseTypeFromKey(cleanKey, productIdentifier);

    // If activation_token is provided in request (online verification), refresh offline expiry
    let offlineExpiry = undefined;
    if (req.body.activation_token) {
      const tokenValid = verifyActivationToken(req.body.activation_token);
      if (tokenValid.valid) {
        // Refresh offline grace period
        const expiryDays = parseInt(process.env.OFFLINE_GRACE_PERIOD_DAYS || '30', 10);
        offlineExpiry = calculateOfflineExpiry(expiryDays);
      }
    }

    return res.status(200).json({
      valid: true,
      licenseMsg: `${selectedProduct.name} license is active`,
      email: data.data?.customer_email || '',
      license_info: {
        license_type: licenseType,
        product_id: productIdentifier,
        expiry_date: null, // Permanent license
      },
      offline_expiry: offlineExpiry,
    });
  } catch (error) {
    console.error('[Verify] Error:', error);
    return res
      .status(500)
      .json({ valid: false, licenseMsg: 'Verification failed internal error' });
  }
}
