import { Router } from 'express';
import { getDrivers, patchDriver, postDriver } from '../controllers/driversController';

export const driversRouter = Router();

driversRouter.get('/', getDrivers);
driversRouter.post('/', postDriver);
driversRouter.patch('/:id', patchDriver);
