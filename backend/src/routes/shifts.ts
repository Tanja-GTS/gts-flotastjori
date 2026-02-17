import { Router } from 'express';
import { getShifts } from '../controllers/shiftsController';
import { getShiftById, postAssignAndEmail, postAssignWeekAndEmail, postConfirmShift } from '../controllers/shiftActionsController';

export const shiftsRouter = Router();

shiftsRouter.get('/', getShifts);
shiftsRouter.get('/:id', getShiftById);
shiftsRouter.post('/:id/assign-and-email', postAssignAndEmail);
shiftsRouter.post('/:id/assign-week-and-email', postAssignWeekAndEmail);
shiftsRouter.post('/:id/confirm', postConfirmShift);
