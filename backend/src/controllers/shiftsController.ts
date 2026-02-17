import type { Request, Response } from 'express';
import { listHydratedShifts } from '../services/shiftInstancesService';
import { cacheGetOrSet } from '../services/simpleCache';
import { sendApiError } from './apiError';

const SHIFTS_TTL_MS = Number(process.env.CACHE_SHIFTS_TTL_MS || 15000);

export async function getShifts(req: Request, res: Response) {
  try {
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;
    const month = typeof req.query.month === 'string' ? req.query.month : undefined;
    const workspaceId =
      typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;

    if (date) {
      // We can support date-level filtering later; for now keep it simple.
      // Most UI operations are month/week based.
    }

    const cacheKey = `shifts|${workspaceId || 'all'}|${month || 'all'}`;
    const shifts = await cacheGetOrSet({
      key: cacheKey,
      ttlMs: SHIFTS_TTL_MS,
      factory: () => listHydratedShifts({ month, workspaceId }),
    });
    res.json({ ok: true, shifts });
  } catch (err) {
    sendApiError(res, err);
  }
}
