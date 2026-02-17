import type { Request, Response } from 'express';
import { generateShiftInstances } from '../services/shiftInstancesService';
import { cacheInvalidatePrefix } from '../services/simpleCache';
import { sendApiError } from './apiError';

export async function postGenerateShifts(req: Request, res: Response) {
  try {
    const month = typeof req.query.month === 'string' ? req.query.month : undefined;
    const workspaceId =
      typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;

    if (!month || !workspaceId) {
      res.status(400).json({ ok: false, error: 'Required query params: month=YYYY-MM&workspaceId=...' });
      return;
    }

    const result = await generateShiftInstances({ month, workspaceId });
    cacheInvalidatePrefix('shifts|');
    res.json({ ok: true, ...result });
  } catch (err) {
    sendApiError(res, err);
  }
}
