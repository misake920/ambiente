import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
export const origin = process.env.APP_ORIGIN || 'http://localhost:5173';
export const isProduction = process.env.NODE_ENV === 'production';
