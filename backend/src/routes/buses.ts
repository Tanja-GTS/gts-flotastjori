import { Router } from 'express';
import { getBuses, patchBus, postBus } from '../controllers/busesController';

export const busesRouter = Router();

busesRouter.get('/', getBuses);
busesRouter.post('/', postBus);
busesRouter.patch('/:id', patchBus);
