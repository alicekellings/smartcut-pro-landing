/**
 * Initialize Database API Endpoint
 * Run this endpoint once to create database tables
 *
 * POST /api/init-db?secret=YOUR_SECRET_KEY
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { query, execute } from '../../../lib/db';
import fs from 'fs';
import path from 'path';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Security: Only allow initialization with secret key
  const secret = req.query.secret as string;

  if (!secret || secret !== process.env.JWT_SECRET) {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    // Read the SQL schema file
    const schemaPath = path.join(process.cwd(), 'database', 'schema.sql');
    const schemaSQL = fs.readFileSync(schemaPath, 'utf8');

    // Split by semicolon to get individual statements
    // Handle PostgreSQL commands that may have semicolons in them
    const statements = schemaSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    // Execute each statement
    let successCount = 0;
    const errors: string[] = [];

    for (const statement of statements) {
      try {
        await execute(statement);
        successCount++;
      } catch (error: any) {
        // Ignore "already exists" errors
        if (error.message.includes('already exists')) {
          successCount++;
        } else {
          errors.push(`Statement: ${statement.substring(0, 100)}... Error: ${error.message}`);
        }
      }
    }

    // Test connection and verify tables
    const testResult = await query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('activations', 'refunded_licenses')
    `);

    const tables = testResult.map((row: any) => row.table_name);

    return res.status(200).json({
      success: true,
      message: 'Database initialized successfully',
      data: {
        statementsExecuted: successCount,
        errors: errors.length > 0 ? errors : undefined,
        tablesCreated: tables,
      },
    });
  } catch (error: any) {
    console.error('[Init DB] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to initialize database',
      error: error.message,
    });
  }
}
