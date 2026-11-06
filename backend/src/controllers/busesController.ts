import type { Request, Response } from 'express';
import {
  createBus,
  deleteBus,
  getBusColumnsInfo,
  invalidateBusesCache,
  listBuses,
  updateBus,
  type BusFieldKey,
  type BusInput,
} from '../services/busesService';
import { cacheGetOrSet, cacheInvalidatePrefix } from '../services/simpleCache';
import { sendApiError } from './apiError';

const BUS_FIELD_KEYS: BusFieldKey[] = ['route', 'plate', 'busNumber', 'type', 'capacity'];

/** Only the bus fields present in the body: a field left out is not touched. */
function busInputFromBody(body: Record<string, unknown>): BusInput {
  const input: BusInput = {};
  for (const key of BUS_FIELD_KEYS) {
    if (body[key] !== undefined) input[key] = body[key] == null ? '' : String(body[key]);
  }
  return input;
}

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
    // Which fields have a column in SharePoint, so the page shows only those.
    let columns: Record<BusFieldKey, boolean> | null = null;
    try {
      columns = await getBusColumnsInfo();
    } catch {
      columns = null;
    }
    res.json({ ok: true, buses, columns });
  } catch (err) {
    sendApiError(res, err);
  }
}

export async function postBus(req: Request, res: Response) {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const bus = await createBus(busInputFromBody(body));

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
    const bus = await updateBus(String(req.params.id ?? ''), busInputFromBody(body));

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
