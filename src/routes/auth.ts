import { Router } from 'express';
import { z } from 'zod';
import { TEST_TENANT, TEST_USER } from '../config/test-context';

export const authRouter = Router();

const onboardSchema = z.object({
  tenantName: z.string().trim().min(2).max(80),
  tenantSlug: z.string().trim().min(2).max(80).optional(),
});

authRouter.get('/me', (request, response) => {
  response.json({
    user: request.authUser ?? TEST_USER,
    tenant: request.tenant ?? TEST_TENANT,
  });
});

authRouter.post('/onboard', async (request, response) => {
  const parsed = onboardSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }

  response.status(200).json({
    ok: true,
    alreadyOnboarded: true,
    tenant: TEST_TENANT,
    user: TEST_USER,
    requestedTenantName: parsed.data.tenantName,
    requestedTenantSlug: parsed.data.tenantSlug ?? null,
  });
});