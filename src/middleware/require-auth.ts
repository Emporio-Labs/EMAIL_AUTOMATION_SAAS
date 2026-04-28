import type { NextFunction, Request, Response } from 'express';
import { TEST_USER } from '../config/test-context';

// Testing-only bypass: attach a mock user and skip bearer-token validation.
export async function requireAuth(request: Request, _response: Response, next: NextFunction): Promise<void> {
  request.authUser = {
    id: TEST_USER.id,
    email: TEST_USER.email,
  } as Request['authUser'];

  next();
}