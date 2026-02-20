import { Router } from 'express';
import { getListFieldsDebug } from '../controllers/debugController';
import { getInstancesMeta } from '../controllers/debugMetaController';
import { getTokenInfo } from '../controllers/debugTokenController';
import { postPatchConfirmationStatus } from '../controllers/debugPatchController';
import { getListFieldsById, getSiteLists } from '../controllers/debugSiteController';
import { getStopsTemplateDebug } from '../controllers/debugStopsTemplateController';
import { getStopsTemplateBreakRows } from '../controllers/debugStopsTemplateBreaksController';
import { getEnvDebug } from '../controllers/debugEnvController';

export const debugRouter = Router();

// Example:
//   GET /api/debug/list-fields?list=patterns&sample=2
//   GET /api/debug/list-fields?list=instances
debugRouter.get('/list-fields', getListFieldsDebug);

// Lists all lists on the configured site.
// Example:
//   GET /api/debug/site-lists
debugRouter.get('/site-lists', getSiteLists);

// Inspect any list by ID.
// Example:
//   GET /api/debug/list-fields-by-id?listId=<GUID>&sample=2
debugRouter.get('/list-fields-by-id', getListFieldsById);

// Explain StopsTemplate ordering/type detection.
// Example:
//   GET /api/debug/stops-template?tripItemId=123
//   GET /api/debug/stops-template?tripItemIds=123,124
debugRouter.get('/stops-template', getStopsTemplateDebug);

// Find sample break rows (as interpreted by the backend) across the StopsTemplate list.
// Example:
//   GET /api/debug/stops-template-breaks?limit=30
debugRouter.get('/stops-template-breaks', getStopsTemplateBreakRows);

// Summary of required columns and choice values on ShiftInstances.
debugRouter.get('/instances-meta', getInstancesMeta);

// Show safe env-derived settings (helps diagnose stale backend process).
// Example:
//   GET /api/debug/env
debugRouter.get('/env', getEnvDebug);

// Shows decoded token info (scopes/roles) without exposing the token.
debugRouter.get('/token-info', getTokenInfo);

// Debug: try different PATCH payload shapes for confirmationStatus.
debugRouter.post('/instances/:id/confirmation', postPatchConfirmationStatus);

// Add the new debugEnvController endpoint to the debug router
debugRouter.get('/list-fields-any', getEnvDebug);
