import type { Request, Response } from 'express';
import { getListFieldDiagnosticsForListId, listSiteLists } from '../services/debugListsService';
import { sendApiError } from './apiError';

export async function getSiteLists(_req: Request, res: Response) {
  try {
    const lists = await listSiteLists();
    res.json({ ok: true, lists });
  } catch (err) {
    sendApiError(res, err);
  }
}

export async function getListFieldsById(req: Request, res: Response) {
  try {
    const listId = String(req.query.listId || '').trim();
    const sample = req.query.sample != null ? Number(req.query.sample) : undefined;
    if (!listId) {
      res.status(400).json({ ok: false, error: 'Missing required query param: listId' });
      return;
    }

    const diagnostics = await getListFieldDiagnosticsForListId({ listId, sample });
    res.json({ ok: true, ...diagnostics });
  } catch (err) {
    sendApiError(res, err);
  }
}
