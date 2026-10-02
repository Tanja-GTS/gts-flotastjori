import type { Request, Response } from 'express';
import { auditShiftInstances } from '../services/shiftInstancesService';
import { sendApiError } from './apiError';

export async function getStaleInstances(req: Request, res: Response) {
  try {
    const workspaceId = String(req.query.workspaceId || '').trim();
    const month = String(req.query.month || '').trim();

    if (!workspaceId || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        ok: false,
        error: 'Required: ?workspaceId=<slug>&month=YYYY-MM',
      });
    }

    const report = await auditShiftInstances({ workspaceId, month });
    return res.json({ ok: true, ...report });
  } catch (err) {
    sendApiError(res, err);
    return;
  }
}
