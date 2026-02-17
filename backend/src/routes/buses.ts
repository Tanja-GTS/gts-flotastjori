import { Router } from 'express';
import { getBuses } from '../controllers/busesController';

export const busesRouter = Router();

busesRouter.get('/', getBuses);
