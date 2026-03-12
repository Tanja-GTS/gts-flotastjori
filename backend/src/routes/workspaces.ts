import { Router } from 'express';
import { getWorkspaces } from '../controllers/workspacesController';

export const workspacesRouter = Router();

workspacesRouter.get('/', getWorkspaces);
