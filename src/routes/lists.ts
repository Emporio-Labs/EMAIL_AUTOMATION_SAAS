import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { TEST_CONTACTS, TEST_LISTS } from '../config/test-context';
import { requireAuth } from '../middleware/require-auth';
import { requireTenant } from '../middleware/require-tenant';
import { supabaseAdmin } from '../lib/supabase';
import { normalizeEmail } from '../utils/normalize-email';

export const listsRouter = Router();

const listSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
});

const addContactsSchema = z.object({
  contactIds: z.array(z.string().uuid()).optional(),
  emails: z.array(z.string().email()).optional(),
}).refine((value) => Boolean((value.contactIds?.length ?? 0) || (value.emails?.length ?? 0)), {
  message: 'Provide contactIds or emails',
});

listsRouter.use(requireAuth, requireTenant);

listsRouter.get('/', async (request, response) => {
  const tenantId = request.tenant?.id;

  const { data, error } = await supabaseAdmin
    .from('lists')
    .select('id, name, description, created_at, updated_at')
    .eq('tenant_id', tenantId as string)
    .order('created_at', { ascending: false });

  if (error) {
    if (env.AUTH_BYPASS) {
      response.json({ lists: TEST_LISTS });
      return;
    }

    response.status(500).json({ error: 'Failed to load lists' });
    return;
  }

  response.json({ lists: data ?? [] });
});

listsRouter.post('/', async (request, response) => {
  const parsed = listSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }

  const tenantId = request.tenant?.id;

  const { data, error } = await supabaseAdmin
    .from('lists')
    .insert({
      tenant_id: tenantId as string,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
    })
    .select('id, name, description, created_at, updated_at')
    .single();

  if (error || !data) {
    if (env.AUTH_BYPASS) {
      response.status(201).json({
        list: {
          id: crypto.randomUUID(),
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });
      return;
    }

    response.status(500).json({ error: 'Failed to create list' });
    return;
  }

  response.status(201).json({ list: data });
});

listsRouter.patch('/:listId', async (request, response) => {
  const parsed = listSchema.partial().safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }

  const tenantId = request.tenant?.id;

  const { data, error } = await supabaseAdmin
    .from('lists')
    .update({
      ...parsed.data,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId as string)
    .eq('id', request.params.listId)
    .select('id, name, description, created_at, updated_at')
    .maybeSingle();

  if (error) {
    response.status(500).json({ error: 'Failed to update list' });
    return;
  }

  if (!data) {
    response.status(404).json({ error: 'List not found' });
    return;
  }

  response.json({ list: data });
});

listsRouter.delete('/:listId', async (request, response) => {
  const tenantId = request.tenant?.id;

  const { error } = await supabaseAdmin
    .from('lists')
    .delete()
    .eq('tenant_id', tenantId as string)
    .eq('id', request.params.listId);

  if (error) {
    response.status(500).json({ error: 'Failed to delete list' });
    return;
  }

  response.status(204).send();
});

listsRouter.get('/:listId/contacts', async (request, response) => {
  const tenantId = request.tenant?.id;

  const { data, error } = await supabaseAdmin
    .from('list_contacts')
    .select('contact_id, contacts!inner(id, email, first_name, last_name, created_at, updated_at)')
    .eq('list_id', request.params.listId)
    .eq('contacts.tenant_id', tenantId as string);

  if (error) {
    if (env.AUTH_BYPASS) {
      response.json({
        contacts: TEST_CONTACTS.map((contact) => ({
          contact_id: contact.id,
          contacts: contact,
        })),
      });
      return;
    }

    response.status(500).json({ error: 'Failed to load list contacts' });
    return;
  }

  response.json({ contacts: data ?? [] });
});

listsRouter.post('/:listId/contacts', async (request, response) => {
  const parsed = addContactsSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }

  const tenantId = request.tenant?.id;
  const listId = request.params.listId;
  const contactIds = parsed.data.contactIds ?? [];
  const emails = (parsed.data.emails ?? []).map(normalizeEmail);

  let resolvedContactIds = [...contactIds];

  if (emails.length > 0) {
    const { data: existingContacts, error: contactsError } = await supabaseAdmin
      .from('contacts')
      .select('id, email')
      .eq('tenant_id', tenantId as string)
      .in('email', emails);

    if (contactsError) {
      response.status(500).json({ error: 'Failed to resolve contacts' });
      return;
    }

    const existingByEmail = new Map((existingContacts ?? []).map((contact) => [contact.email, contact.id]));
    const missingEmails = emails.filter((email) => !existingByEmail.has(email));

    if (missingEmails.length > 0) {
      const { data: insertedContacts, error: insertContactsError } = await supabaseAdmin
        .from('contacts')
        .insert(
          missingEmails.map((email) => ({
            tenant_id: tenantId as string,
            email,
          })),
        )
        .select('id, email');

      if (insertContactsError) {
        response.status(500).json({ error: 'Failed to create contacts' });
        return;
      }

      resolvedContactIds.push(...(insertedContacts ?? []).map((contact) => contact.id));
    }

    resolvedContactIds.push(...(existingContacts ?? []).map((contact) => contact.id));
  }

  const uniqueContactIds = Array.from(new Set(resolvedContactIds));

  const { error } = await supabaseAdmin.from('list_contacts').upsert(
    uniqueContactIds.map((contactId) => ({
      list_id: listId,
      contact_id: contactId,
    })),
    {
      onConflict: 'list_id,contact_id',
    },
  );

  if (error) {
    response.status(500).json({ error: 'Failed to add contacts to list' });
    return;
  }

  response.status(201).json({ added: uniqueContactIds.length });
});

listsRouter.delete('/:listId/contacts/:contactId', async (request, response) => {
  const tenantId = request.tenant?.id;
  const listId = request.params.listId;

  const { error } = await supabaseAdmin
    .from('list_contacts')
    .delete()
    .eq('list_id', listId)
    .eq('contact_id', request.params.contactId)
    .eq('contacts.tenant_id', tenantId as string);

  if (error) {
    response.status(500).json({ error: 'Failed to remove contact from list' });
    return;
  }

  response.status(204).send();
});