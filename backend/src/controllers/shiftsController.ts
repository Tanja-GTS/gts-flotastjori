import type { Request, Response } from 'express';
import { ensureShiftInstancesForMonth, listHydratedShifts } from '../services/shiftInstancesService';
import { cacheGetOrSet, cacheInvalidatePrefix } from '../services/simpleCache';
import { sendApiError } from './apiError';

const SHIFTS_TTL_MS = Number(process.env.CACHE_SHIFTS_TTL_MS || 15000);
const AUTO_GENERATE_ON_READ = !['false', '0', 'no', 'off'].includes(
  String(process.env.AUTO_GENERATE_SHIFTS_ON_READ || 'true').trim().toLowerCase()
);

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
    if (AUTO_GENERATE_ON_READ && workspaceId && month) {
      const result = await ensureShiftInstancesForMonth({ workspaceId, month });
      if (result.created > 0) cacheInvalidatePrefix(cacheKey);
      if (result.warnings.length > 0) {
        console.warn(
          `[shifts] auto-generation warnings for ${workspaceId} ${month}:\n${result.warnings.join('\n')}`
        );
      }
    }

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
