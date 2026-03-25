import { Router } from 'express';
import { getTimonReadinessStatus, postTimonPreview, postTimonSync } from '../controllers/timonController';

export const timonRouter = Router();

timonRouter.get('/readiness', getTimonReadinessStatus);
timonRouter.post('/preview', postTimonPreview);
timonRouter.post('/sync', postTimonSync);