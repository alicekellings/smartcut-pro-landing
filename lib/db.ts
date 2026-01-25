/**
 * Database Connection Module
 * Provides database connection and query utilities for PostgreSQL
 */

import postgres from 'postgres';

// PostgreSQL connection
let sql: postgres.Sql<{}> | null = null;

/**
 * Get database connection
 * Creates new connection if not exists
 */
export function getDatabase(): postgres.Sql<{}> {
  if (!sql) {
const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('Database connection string not configured. Please set DATABASE_URL environment variable.');
  }

    sql = postgres(connectionString, {
      max: 10, // Maximum connections in pool
      idle_timeout: 20, // Idle timeout
      connect_timeout: 10, // Connection timeout
    });

    console.log('[DB] Database connection established');
  }

  return sql;
}

/**
 * Close database connection (useful for testing)
 */
export async function closeDatabase(): Promise<void> {
  if (sql) {
    await sql.end();
    sql = null;
    console.log('[DB] Database connection closed');
  }
}

/**
 * Execute a raw SQL query
 */
export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const db = getDatabase();
  try {
    return await db.unsafe(text, params);
  } catch (error) {
    console.error('[DB] Query error:', error);
    throw error;
  }
}

/**
 * Execute a query and return first row
 */
export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Execute a query and return rows affected count
 */
export async function execute(text: string, params?: any[]): Promise<number> {
  const db = getDatabase();
  try {
    const result = await db.unsafe(text, params);
    return result.count || 0;
  } catch (error) {
    console.error('[DB] Execute error:', error);
    throw error;
  }
}

/**
 * Check if database is connected
 */
export function isConnected(): boolean {
  return sql !== null;
}
