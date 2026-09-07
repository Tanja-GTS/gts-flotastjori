import { Router } from 'express';
import {
  getTimonClockStatus,
  getTimonReadinessStatus,
  postTimonPreview,
  postTimonSync,
} from '../controllers/timonController';

export const timonRouter = Router();

timonRouter.get('/readiness', getTimonReadinessStatus);
timonRouter.get('/clock-status', getTimonClockStatus);
timonRouter.post('/preview', postTimonPreview);
timonRouter.post('/sync', postTimonSync);
