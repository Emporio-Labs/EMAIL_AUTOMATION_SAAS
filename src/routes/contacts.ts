import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { TEST_CONTACTS } from '../config/test-context';
import { requireAuth } from '../middleware/require-auth';
import { requireTenant } from '../middleware/require-tenant';
import { supabaseAdmin } from '../lib/supabase';
import { normalizeEmail } from '../utils/normalize-email';

export const contactsRouter = Router();

const contactSchema = z.object({
  email: z.string().trim().email(),
  // Treat empty strings as missing — transform empty -> undefined then optional
  firstName: z.string().trim().max(120).transform((s) => (s === "" ? undefined : s)).optional(),
  lastName: z.string().trim().max(120).transform((s) => (s === "" ? undefined : s)).optional(),
  // Custom fields for merge tags, e.g. { "company": "Acme", "plan": "Pro" }.
  // When given, they replace the contact's existing custom fields.
  attributes: z
    .record(z.string().trim().regex(/^[a-zA-Z_]\w{0,49}$/, 'Field names use letters, digits and _'), z.union([z.string().max(1000), z.number(), z.boolean(), z.null()]))
    .refine((v) => Object.keys(v).length <= 50, 'At most 50 custom fields')
    .optional(),
});

const importSchema = z.object({
  contacts: z.array(contactSchema).min(1),
});

const CONTACT_COLUMNS = 'id, email, first_name, last_name, attributes, created_at, updated_at';

contactsRouter.use(requireAuth, requireTenant);

contactsRouter.get('/', async (request, response) => {
  const tenantId = request.tenant?.id;

  const { data, error } = await supabaseAdmin
    .from('contacts')
    .select(CONTACT_COLUMNS)
    .eq('tenant_id', tenantId as string)
    .order('created_at', { ascending: false });

  if (error) {
    if (env.AUTH_BYPASS) {
      response.json({ contacts: TEST_CONTACTS });
      return;
    }

    response.status(500).json({ error: 'Failed to load contacts' });
    return;
  }

  response.json({ contacts: data ?? [] });
});

contactsRouter.post('/', async (request, response) => {
  const parsed = contactSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }

  const tenantId = request.tenant?.id;
  const email = normalizeEmail(parsed.data.email);

  const { data, error } = await supabaseAdmin
    .from('contacts')
    .upsert(
      {
        tenant_id: tenantId as string,
        email,
        first_name: parsed.data.firstName && parsed.data.firstName.trim() ? parsed.data.firstName.trim() : null,
        last_name: parsed.data.lastName && parsed.data.lastName.trim() ? parsed.data.lastName.trim() : null,
        ...(parsed.data.attributes ? { attributes: parsed.data.attributes } : {}),
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'tenant_id,email',
      },
    )
    .select(CONTACT_COLUMNS)
    .single();

  if (error || !data) {
    if (env.AUTH_BYPASS) {
      response.status(201).json({
        contact: {
          id: crypto.randomUUID(),
          email,
          first_name: parsed.data.firstName ?? null,
          last_name: parsed.data.lastName ?? null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });
      return;
    }

    response.status(500).json({ error: 'Failed to save contact' });
    return;
  }

  response.status(201).json({ contact: data });
});

contactsRouter.post('/import', async (request, response) => {
  const parsed = importSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }

  const tenantId = request.tenant?.id;
  const rows = parsed.data.contacts.map((contact) => ({
    tenant_id: tenantId as string,
    email: normalizeEmail(contact.email),
    first_name: contact.firstName && contact.firstName.trim() ? contact.firstName.trim() : null,
    last_name: contact.lastName && contact.lastName.trim() ? contact.lastName.trim() : null,
    ...(contact.attributes ? { attributes: contact.attributes } : {}),
    updated_at: new Date().toISOString(),
  }));

  // Upsert rows with and without custom fields separately, so importing a
  // contact without fields does not wipe the fields it already has.
  const withAttributes = rows.filter((row) => 'attributes' in row);
  const withoutAttributes = rows.filter((row) => !('attributes' in row));
  const results = await Promise.all(
    [withAttributes, withoutAttributes]
      .filter((batch) => batch.length > 0)
      .map((batch) => supabaseAdmin.from('contacts').upsert(batch, { onConflict: 'tenant_id,email' })),
  );
  const error = results.find((result) => result.error)?.error;

  if (error) {
    if (env.AUTH_BYPASS) {
      response.status(201).json({ imported: rows.length });
      return;
    }

    response.status(500).json({ error: 'Failed to import contacts' });
    return;
  }

  response.status(201).json({ imported: rows.length });
});

contactsRouter.delete('/:contactId', async (request, response) => {
  const tenantId = request.tenant?.id;

  const { error } = await supabaseAdmin
    .from('contacts')
    .delete()
    .eq('tenant_id', tenantId as string)
    .eq('id', request.params.contactId);

  if (error) {
    response.status(500).json({ error: 'Failed to delete contact' });
    return;
  }

  response.status(204).send();
});