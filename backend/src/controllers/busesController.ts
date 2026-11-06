import type { Request, Response } from 'express';
import {
  createBus,
  deleteBus,
  invalidateBusesCache,
  listBuses,
  updateBus,
  type BusInput,
} from '../services/busesService';
import { cacheGetOrSet, cacheInvalidatePrefix } from '../services/simpleCache';
import { sendApiError } from './apiError';

const BUSES_TTL_MS = Number(process.env.CACHE_BUSES_TTL_MS || 10 * 60 * 1000);

export async function getBuses(req: Request, res: Response) {
  try {
    // ?fresh=1: read SharePoint now, so changes made there show at once.
    if (req.query.fresh === '1') {
      invalidateBusesCache();
      cacheInvalidatePrefix('buses');
    }
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
    const bus = await createBus({
      plate: String(body.plate ?? ''),
      route: String(body.route ?? ''),
      capacity: body.capacity == null ? '' : String(body.capacity),
    });

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
    // Pass on only the fields that were sent: a field left out is not changed.
    const input: BusInput = {};
    if (body.plate !== undefined) input.plate = String(body.plate ?? '');
    if (body.route !== undefined) input.route = String(body.route ?? '');
    if (body.capacity !== undefined) input.capacity = body.capacity == null ? '' : String(body.capacity);
    const bus = await updateBus(String(req.params.id ?? ''), input);

    // Shifts embed bus plates, so clear them with the list.
    cacheInvalidatePrefix('buses');
    cacheInvalidatePrefix('shifts|');

    res.json({ ok: true, bus });
  } catch (err) {
    sendApiError(res, err);
  }
}

export async function removeBus(req: Request, res: Response) {
  try {
    await deleteBus(String(req.params.id ?? ''));
    cacheInvalidatePrefix('buses');
    cacheInvalidatePrefix('shifts|');
    res.json({ ok: true });
  } catch (err) {
    sendApiError(res, err);
  }
}
