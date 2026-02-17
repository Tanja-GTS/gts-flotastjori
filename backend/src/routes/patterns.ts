import { Router } from 'express';
import { getPatterns } from '../controllers/patternsController';

export const patternsRouter = Router();

patternsRouter.get('/', getPatterns);
