import type { NextFunction, Request, Response } from 'express';
import { TEST_TENANT } from '../config/test-context';

// Testing-only bypass: attach a fixed tenant so route handlers can run without membership checks.
export async function requireTenant(request: Request, _response: Response, next: NextFunction): Promise<void> {
  request.tenant = {
    id: TEST_TENANT.id,
    name: TEST_TENANT.name,
    slug: TEST_TENANT.slug,
    role: TEST_TENANT.role,
  };

  next();
}