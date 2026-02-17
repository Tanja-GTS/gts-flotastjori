import type { Request, Response } from 'express';
import { debugExplainStopsForTripIds } from '../services/stopsTemplateService';
import { sendApiError } from './apiError';

export async function getStopsTemplateDebug(req: Request, res: Response) {
  try {
    const raw = String(req.query.tripItemIds || req.query.tripItemId || '').trim();
    if (!raw) {
      res.status(400).json({
        ok: false,
        error: 'Missing query param: tripItemIds (comma-separated) or tripItemId',
      });
      return;
    }

    const tripItemIds = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 50);

    const explained = await debugExplainStopsForTripIds({ tripItemIds });
    res.json({ ok: true, ...explained });
  } catch (err) {
    sendApiError(res, err);
  }
}
