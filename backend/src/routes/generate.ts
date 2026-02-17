import { Router } from 'express';
import { postGenerateShifts } from '../controllers/generationController';

export const generateRouter = Router();

generateRouter.post('/shifts', postGenerateShifts);
