import type { Request, Response } from 'express';
import { createDriver, listDrivers } from '../services/driversService';
import { cacheGetOrSet, cacheInvalidatePrefix } from '../services/simpleCache';
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

export async function postDriver(req: Request, res: Response) {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const driver = await createDriver({
      name: String(body.name ?? ''),
      email: String(body.email ?? ''),
      phone: String(body.phone ?? ''),
      ssn: String(body.ssn ?? ''),
    });

    // The drivers list is cached by the controller too, and shifts embed driver
    // names, so clear both or the new driver will not show up for minutes.
    cacheInvalidatePrefix('drivers');
    cacheInvalidatePrefix('shifts|');

    res.status(201).json({ ok: true, driver });
  } catch (err) {
    sendApiError(res, err);
  }
}
