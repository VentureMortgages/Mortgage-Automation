/**
 * Health Check Endpoint Handler
 *
 * Returns server status, kill switch state, version, and timestamp.
 * Used by load balancers, monitoring, and manual verification.
 */

import type { Request, Response } from 'express';
import { appConfig } from '../config.js';

export function healthHandler(_req: Request, res: Response): void {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    killSwitch: appConfig.killSwitch,
    version: process.env.npm_package_version ?? 'dev',
  });
}
