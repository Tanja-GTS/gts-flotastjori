import type { Request, Response } from 'express';
import { previewShiftGeneration } from '../services/shiftInstancesService';
import { sendApiError } from './apiError';

export async function getShiftGenerationPreview(req: Request, res: Response) {
  try {
    const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId.trim() : '';
    const month = typeof req.query.month === 'string' ? req.query.month.trim() : '';

    if (!workspaceId || !month) {
      return res.status(400).json({
        ok: false,
        error: 'Required query params: workspaceId=...&month=YYYY-MM',
      });
    }

    const preview = await previewShiftGeneration({ workspaceId, month });
    return res.json({ ok: true, preview });
  } catch (err) {
    sendApiError(res, err);
  }
}