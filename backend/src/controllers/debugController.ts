import type { Request, Response } from 'express';
import { getListFieldDiagnostics, type DebugListKey } from '../services/debugListsService';
import { sendApiError } from './apiError';

function isDebugListKey(value: unknown): value is DebugListKey {
  return value === 'patterns' || value === 'instances';
}

export async function getListFieldsDebug(req: Request, res: Response) {
  try {
    const listRaw = typeof req.query.list === 'string' ? req.query.list : '';
    const list = listRaw.trim().toLowerCase();

    if (!isDebugListKey(list)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid list. Use ?list=patterns or ?list=instances',
      });
    }

    const sampleRaw = typeof req.query.sample === 'string' ? req.query.sample : undefined;

    const diagnostics = await getListFieldDiagnostics({
      list,
      sample: sampleRaw ? Number(sampleRaw) : undefined,
    });

    return res.json({ ok: true, diagnostics });
  } catch (err) {
    sendApiError(res, err);
    return;
  }
}
