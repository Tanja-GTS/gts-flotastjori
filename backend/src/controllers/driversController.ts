import type { Request, Response } from 'express';
import { listDrivers } from '../services/driversService';
import { cacheGetOrSet } from '../services/simpleCache';
import { sendApiError } from './apiError';

const DRIVERS_TTL_MS = Number(process.env.CACHE_DRIVERS_TTL_MS || 10 * 60 * 1000);

export async function getDrivers(_req: Request, res: Response) {
  try {
    const drivers = await cacheGetOrSet({
      key: 'drivers',
      ttlMs: DRIVERS_TTL_MS,
      factory: () => listDrivers(),
    });
    res.json({ ok: true, drivers });
  } catch (err) {
    sendApiError(res, err);
  }
}
