import { Router } from 'express';
import { getBuses, patchBus, postBus, removeBus } from '../controllers/busesController';

export const busesRouter = Router();

busesRouter.get('/', getBuses);
busesRouter.post('/', postBus);
busesRouter.patch('/:id', patchBus);
busesRouter.delete('/:id', removeBus);
