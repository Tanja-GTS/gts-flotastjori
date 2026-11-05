import type { Request, Response } from 'express';
import { createBus, listBuses, updateBus } from '../services/busesService';
import { cacheGetOrSet, cacheInvalidatePrefix } from '../services/simpleCache';
import { sendApiError } from './apiError';

const BUSES_TTL_MS = Number(process.env.CACHE_BUSES_TTL_MS || 10 * 60 * 1000);

export async function getBuses(_req: Request, res: Response) {
  try {
    const buses = await cacheGetOrSet({
      key: 'buses',
      ttlMs: BUSES_TTL_MS,
      factory: () => listBuses(),
    });
    // buses now includes routeId and routeLabel
    res.json({ ok: true, buses });
  } catch (err) {
    sendApiError(res, err);
  }
}

export async function postBus(req: Request, res: Response) {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const bus = await createBus({ plate: String(body.plate ?? '') });

    // The buses list is cached by the controller too, and shifts embed bus
    // plates, so clear both or the new bus will not show up for minutes.
    cacheInvalidatePrefix('buses');
    cacheInvalidatePrefix('shifts|');

    res.status(201).json({ ok: true, bus });
  } catch (err) {
    sendApiError(res, err);
  }
}

export async function patchBus(req: Request, res: Response) {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const bus = await updateBus(String(req.params.id ?? ''), { plate: String(body.plate ?? '') });

    // Shifts embed bus plates, so clear them with the list.
    cacheInvalidatePrefix('buses');
    cacheInvalidatePrefix('shifts|');

    res.json({ ok: true, bus });
  } catch (err) {
    sendApiError(res, err);
  }
}
