import type { Request, Response } from 'express';
import { deleteGeneratedShiftInstances, generateShiftInstances } from '../services/shiftInstancesService';
import { cacheInvalidatePrefix } from '../services/simpleCache';
import { sendApiError } from './apiError';
import { listShiftPatterns } from '../services/shiftPatternsService';

export async function postGenerateShifts(req: Request, res: Response) {
  try {
    const month = typeof req.query.month === 'string' ? req.query.month : undefined;
    const workspaceId =
      typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;

    const resetRaw = typeof req.query.reset === 'string' ? req.query.reset : undefined;
    const reset = String(resetRaw || '').trim().toLowerCase();
    const doReset = reset === '1' || reset === 'true' || reset === 'yes' || reset === 'on';

    if (!month || !workspaceId) {
      res.status(400).json({ ok: false, error: 'Required query params: month=YYYY-MM&workspaceId=...' });
      return;
    }

    let deleted = 0;
    if (doReset) {
      const patternsAll = await listShiftPatterns({ workspaceId, includeInvalid: true });
      if (patternsAll.length === 0) {
        res.status(422).json({
          ok: false,
          error:
            `No ShiftPatterns found for workspace “${workspaceId}”. ` +
            `Nothing was deleted. Add rows to the ShiftPatterns list with workspaceId=${workspaceId}, then try again.`,
        });
        return;
      }

      const invalid = patternsAll
        .map((p) => {
          const missing: string[] = [];
          const hasDay = Array.isArray(p.dayOfWeek) ? p.dayOfWeek.length > 0 : Boolean(p.dayOfWeek);
          if (!String(p.route || '').trim()) missing.push('route');
          if (!String(p.shiftType || '').trim()) missing.push('shiftType');
          if (!hasDay) missing.push('dayOfWeek');
          if (!String(p.startTime || '').trim()) missing.push('startTime');
          if (!String(p.endTime || '').trim()) missing.push('endTime');
          return { p, missing };
        })
        .filter((x) => x.missing.length > 0);

      if (invalid.length > 0) {
        const lines = invalid
          .slice(0, 10)
          .map(({ p, missing }) => {
            const label = String(p.routeName || p.route || p.id || '').trim();
            return `#${p.id} “${label}” missing: ${missing.join(', ')}`;
          });
        const more = invalid.length > 10 ? ` (+${invalid.length - 10} more)` : '';
        res.status(422).json({
          ok: false,
          error:
            `ShiftPatterns for workspace “${workspaceId}” are incomplete. ` +
            `Nothing was deleted. Fix these fields in the ShiftPatterns list, then try again:\n` +
            lines.join('\n') +
            more,
        });
        return;
      }

      const r = await deleteGeneratedShiftInstances({ workspaceId, month });
      deleted = r.deleted;
    }

    const result = await generateShiftInstances({ month, workspaceId });
    cacheInvalidatePrefix('shifts|');
    res.json({ ok: true, deleted, ...result });
  } catch (err) {
    sendApiError(res, err);
  }
}
