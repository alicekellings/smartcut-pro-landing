/**
 * License Utilities
 * Helper functions for license key management
 */

import jwt from 'jsonwebtoken';

// License type definitions
export interface LicenseInfo {
  license_type: string;
  expiry_date: string | null;
  features: string[];
  product_id: string;
}

// License configuration
export const LICENSE_CONFIG = {
  photobatchpro: {
    types: {
      PERSONAL: {
        features: ['basic_rename', 'basic_exif', 'find_duplicates'],
        max_vehicles: 0, // Not applicable
      },
      PRO: {
        features: ['basic_rename', 'basic_exif', 'find_duplicates', 'format_convert', 'resize', 'watermark'],
        max_vehicles: 0,
      },
      ENTERPRISE: {
        features: ['basic_rename', 'basic_exif', 'find_duplicates', 'format_convert', 'resize', 'watermark', 'batch_process', 'advanced_filters'],
        max_vehicles: 0,
      },
    },
  },
  vehiclevaultpro: {
    types: {
      PERSONAL: {
        features: ['vehicle_management', 'fuel_tracking', 'service_records', 'basic_dashboard'],
        max_vehicles: 1,
      },
      PRO: {
        features: ['vehicle_management', 'fuel_tracking', 'service_records', 'basic_dashboard', 'data_export', 'advanced_reports'],
        max_vehicles: 5,
      },
      LIFETIME: {
        features: ['vehicle_management', 'fuel_tracking', 'service_records', 'basic_dashboard', 'data_export', 'advanced_reports', 'priority_support'],
        max_vehicles: 999, // Unlimited
      },
    },
  },
};

/**
 * Get license type from license key
 * Key format: PREFIX-XXXXXX-TYPE
 * e.g., PB-123456-PRO, VV-789012-PERSONAL
 */
export function getLicenseTypeFromKey(licenseKey: string, productId: string): string {
  const parts = licenseKey.split('-');

  if (parts.length < 3) {
    // Trial license
    if (licenseKey.startsWith('TRIAL-')) {
      return 'TRIAL';
    }
    return 'PERSONAL'; // Default
  }

  const type = parts[parts.length - 1].toUpperCase();

  // Validate type exists for product
  const config = LICENSE_CONFIG[productId as keyof typeof LICENSE_CONFIG];
  if (config && config.types[type as keyof typeof config.types]) {
    return type;
  }

  return 'PERSONAL'; // Fallback
}

/**
 * Get license info from license key
 */
export function getLicenseInfoFromKey(licenseKey: string, productId: string): LicenseInfo {
  const licenseType = getLicenseTypeFromKey(licenseKey, productId);
  const config = LICENSE_CONFIG[productId as keyof typeof LICENSE_CONFIG];

  if (!config || licenseType === 'TRIAL') {
    // Trial license
    return {
      license_type: 'TRIAL',
      expiry_date: null, // Will be calculated from activation date
      features: ['basic_rename', 'basic_exif', 'find_duplicates'],
      product_id: productId,
    };
  }

  const typeConfig = config.types[licenseType as keyof typeof config.types];

  return {
    license_type: licenseType,
    expiry_date: null, // Permanent licenses
    features: typeConfig.features,
    product_id: productId,
  };
}

/**
 * Generate JWT activation token
 * Used for offline verification
 */
export function generateActivationToken(
  licenseKey: string,
  machineId: string,
  productId: string,
  expiryDays: number = 30,
): string {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error('JWT_SECRET not configured');
  }

  const payload = {
    license_key: licenseKey,
    machine_id: machineId,
    product_id: productId,
    expiry: Math.floor(Date.now() / 1000) + (expiryDays * 24 * 60 * 60),
    iat: Math.floor(Date.now() / 1000),
  };

  return jwt.sign(payload, secret, { algorithm: 'HS256' });
}

/**
 * Verify JWT activation token
 */
export function verifyActivationToken(token: string): {
  valid: boolean;
  payload?: any;
  error?: string;
} {
  try {
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      return { valid: false, error: 'JWT_SECRET not configured' };
    }

    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });

    // Check expiry
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return { valid: false, error: 'Token expired' };
    }

    return { valid: true, payload };
  } catch (error: any) {
    return {
      valid: false,
      error: error.message || 'Invalid token',
    };
  }
}

/**
 * Calculate offline expiry date
 */
export function calculateOfflineExpiry(days: number = 30): string {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);
  return expiry.toISOString();
}

/**
 * Format license key for display
 */
export function formatLicenseKey(licenseKey: string): string {
  return licenseKey.trim().toUpperCase();
}

/**
 * Validate license key format
 */
export function isValidLicenseKeyFormat(licenseKey: string): boolean {
  // Format: XXXX-XXXXX-XXXX (alphanumeric with dashes)
  const pattern = /^[A-Z0-9-]{10,}$/i;
  return pattern.test(licenseKey);
}
