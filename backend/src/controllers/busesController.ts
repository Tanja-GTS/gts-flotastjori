import type { Request, Response } from 'express';
import { listBuses } from '../services/busesService';
import { cacheGetOrSet } from '../services/simpleCache';
import { sendApiError } from './apiError';

const BUSES_TTL_MS = Number(process.env.CACHE_BUSES_TTL_MS || 10 * 60 * 1000);

export async function getBuses(_req: Request, res: Response) {
  try {
    const buses = await cacheGetOrSet({
      key: 'buses',
      ttlMs: BUSES_TTL_MS,
      factory: () => listBuses(),
    });
    res.json({ ok: true, buses });
  } catch (err) {
    sendApiError(res, err);
  }
}
