import { Router } from 'express';
import { getTimetables } from '../controllers/timetablesController';

export const timetablesRouter = Router();

timetablesRouter.get('/', getTimetables);
