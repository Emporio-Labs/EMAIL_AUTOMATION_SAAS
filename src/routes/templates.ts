import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/require-auth';
import { requireApiKey } from '../middleware/require-api-key';
import { requireTenant } from '../middleware/require-tenant';
import { supabaseAdmin } from '../lib/supabase';
import { normalizeEmail } from '../utils/normalize-email';
import { contactVariables, htmlToText, renderTemplate, templateTags } from '../lib/render-template';

// Saved email templates with {{merge_tags}}.
//   GET    /v1/templates              list
//   POST   /v1/templates              create
//   GET    /v1/templates/:id          one, with the merge tags it uses
//   PATCH  /v1/templates/:id          update
//   DELETE /v1/templates/:id          delete
//   POST   /v1/templates/:id/preview  render with variables and/or a contact
// Works with a dashboard session or an API key.

export const templatesRouter = Router();

const MAX_HTML_BYTES = 200 * 1024;

const templateFields = {
  name: z.string().trim().min(1).max(120),
  subject: z.string().trim().min(1).max(200),
  html: z.string().trim().min(1).refine((v) => Buffer.byteLength(v, 'utf8') <= MAX_HTML_BYTES, {
    message: `html must be at most ${MAX_HTML_BYTES / 1024} KB`,
  }),
  text: z.string().trim().max(100_000).nullable().optional(),
};

const createSchema = z.object(templateFields);
const updateSchema = z.object(templateFields).partial().refine((v) => Object.keys(v).length > 0, {
  message: 'Nothing to update',
});
const previewSchema = z.object({
  variables: z.record(z.string(), z.unknown()).optional(),
  contactEmail: z.string().trim().email().optional(),
});
const idSchema = z.string().uuid();

const COLUMNS = 'id, name, subject, html, text, created_at, updated_at';

async function requireTemplatesAuth(request: Request, response: Response, next: NextFunction): Promise<void> {
  if (typeof request.headers['x-api-key'] !== 'undefined') {
    await requireApiKey(request, response, next);
    return;
  }
  await requireAuth(request, response, () => undefined);
  if (response.headersSent) return;
  await requireTenant(request, response, next);
}

templatesRouter.use(requireTemplatesAuth);

function withTags<T extends { subject: string; html: string; text: string | null }>(row: T) {
  return { ...row, mergeTags: templateTags(row.subject, row.html, row.text) };
}

templatesRouter.get('/', async (request, response) => {
  const { data, error } = await supabaseAdmin
    .from('email_templates')
    .select('id, name, subject, created_at, updated_at')
    .eq('tenant_id', request.tenant!.id)
    .order('updated_at', { ascending: false });

  if (error) {
    response.status(500).json({ error: 'Failed to load templates' });
    return;
  }
  response.json({ templates: data ?? [] });
});

templatesRouter.post('/', async (request, response) => {
  const parsed = createSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('email_templates')
    .insert({ tenant_id: request.tenant!.id, ...parsed.data, text: parsed.data.text || null })
    .select(COLUMNS)
    .single();

  if (error) {
    if (error.code === '23505') {
      response.status(409).json({ error: 'A template with this name already exists' });
      return;
    }
    response.status(500).json({ error: 'Failed to create template' });
    return;
  }
  response.status(201).json({ template: withTags(data) });
});

templatesRouter.get('/:id', async (request, response) => {
  if (!idSchema.safeParse(request.params.id).success) {
    response.status(404).json({ error: 'Template not found' });
    return;
  }
  const { data, error } = await supabaseAdmin
    .from('email_templates')
    .select(COLUMNS)
    .eq('tenant_id', request.tenant!.id)
    .eq('id', request.params.id)
    .maybeSingle();

  if (error) {
    response.status(500).json({ error: 'Failed to load template' });
    return;
  }
  if (!data) {
    response.status(404).json({ error: 'Template not found' });
    return;
  }
  response.json({ template: withTags(data) });
});

templatesRouter.patch('/:id', async (request, response) => {
  const parsed = updateSchema.safeParse(request.body);
  if (!parsed.success || !idSchema.safeParse(request.params.id).success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.success ? undefined : parsed.error.flatten() });
    return;
  }

  const update: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };
  if ('text' in parsed.data) update.text = parsed.data.text || null;

  const { data, error } = await supabaseAdmin
    .from('email_templates')
    .update(update)
    .eq('tenant_id', request.tenant!.id)
    .eq('id', request.params.id)
    .select(COLUMNS)
    .maybeSingle();

  if (error) {
    if (error.code === '23505') {
      response.status(409).json({ error: 'A template with this name already exists' });
      return;
    }
    response.status(500).json({ error: 'Failed to update template' });
    return;
  }
  if (!data) {
    response.status(404).json({ error: 'Template not found' });
    return;
  }
  response.json({ template: withTags(data) });
});

templatesRouter.delete('/:id', async (request, response) => {
  if (!idSchema.safeParse(request.params.id).success) {
    response.status(404).json({ error: 'Template not found' });
    return;
  }
  const { error } = await supabaseAdmin
    .from('email_templates')
    .delete()
    .eq('tenant_id', request.tenant!.id)
    .eq('id', request.params.id);

  if (error) {
    response.status(500).json({ error: 'Failed to delete template' });
    return;
  }
  response.status(204).send();
});

templatesRouter.post('/:id/preview', async (request, response) => {
  const parsed = previewSchema.safeParse(request.body ?? {});
  if (!parsed.success || !idSchema.safeParse(request.params.id).success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.success ? undefined : parsed.error.flatten() });
    return;
  }
  const tenantId = request.tenant!.id;

  const { data: template } = await supabaseAdmin
    .from('email_templates')
    .select(COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('id', request.params.id)
    .maybeSingle();

  if (!template) {
    response.status(404).json({ error: 'Template not found' });
    return;
  }

  let contact;
  if (parsed.data.contactEmail) {
    const { data } = await supabaseAdmin
      .from('contacts')
      .select('email, first_name, last_name, attributes')
      .eq('tenant_id', tenantId)
      .eq('email', normalizeEmail(parsed.data.contactEmail))
      .maybeSingle();
    contact = data ?? undefined;
  }

  const variables = {
    ...contactVariables(contact, parsed.data.contactEmail ?? 'someone@example.com'),
    ...(parsed.data.variables ?? {}),
  };

  response.json({
    subject: renderTemplate(template.subject, variables, 'text'),
    html: renderTemplate(template.html, variables, 'html'),
    text: renderTemplate(template.text || htmlToText(template.html), variables, 'text'),
  });
});
