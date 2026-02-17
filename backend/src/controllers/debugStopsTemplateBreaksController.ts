import type { Request, Response } from 'express';
import { debugFindBreakRows } from '../services/stopsTemplateService';
import { sendApiError } from './apiError';

export async function getStopsTemplateBreakRows(req: Request, res: Response) {
  try {
    const limit = req.query.limit != null ? Number(req.query.limit) : undefined;
    const result = await debugFindBreakRows({ limit });
    res.json({ ok: true, ...result });
  } catch (err) {
    sendApiError(res, err);
  }
}
