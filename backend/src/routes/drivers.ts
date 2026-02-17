import { Router } from 'express';
import { getDrivers } from '../controllers/driversController';

export const driversRouter = Router();

driversRouter.get('/', getDrivers);
