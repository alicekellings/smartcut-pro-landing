# License Key Management API Routes

This directory contains API endpoints for license key management.

## Endpoints

### `/api/verify`
- **Method**: POST
- **Purpose**: Verify license key validity
- **Checks**:
  - Payhip API validation
  - Database activation status
  - Refund status
  - Device limits

### `/api/activate`
- **Method**: POST
- **Purpose**: Activate license on a device
- **Features**:
  - Payhip verification
  - Device binding (machine ID)
  - Activation limit enforcement (max 3 devices)
  - Offline grace period

### `/api/admin/revoke`
- **Method**: POST
- **Purpose**: Revoke license (for refunds)
- **Parameters**: license_key, reason
- **Effects**:
  - Marks license as refunded
  - Cancels all activations

### `/api/admin/activations`
- **Method**: GET
- **Purpose**: View all activation records
- **Admin only**: Requires authentication

## Environment Variables Required

- `PAYHIP_API_KEY`: Payhip API key
- `POSTGRES_URL`: Database connection URL
- `JWT_SECRET`: Secret for JWT signing
- `MAX_ACTIVATIONS_PER_LICENSE`: Max devices per license (default: 3)
- `OFFLINE_GRACE_PERIOD_DAYS`: Offline grace period (default: 30)
