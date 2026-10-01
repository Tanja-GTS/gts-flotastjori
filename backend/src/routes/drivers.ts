import { Router } from 'express';
import { getDrivers, postDriver } from '../controllers/driversController';

export const driversRouter = Router();

driversRouter.get('/', getDrivers);
driversRouter.post('/', postDriver);
