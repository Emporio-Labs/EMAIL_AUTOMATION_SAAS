export const TEST_USER = {
  id: '22222222-2222-2222-2222-222222222222',
  email: 'test@example.com',
} as const;

export const TEST_TENANT = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Mock Tenant',
  slug: 'mock-tenant',
  role: 'owner',
} as const;

export const TEST_CONTACTS = [
  {
    id: '44444444-4444-4444-4444-444444444441',
    email: 'sagunvarma25@gmail.com',
    first_name: 'Sagun',
    last_name: 'Varma',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
  {
    id: '44444444-4444-4444-4444-444444444442',
    email: 'yeshwanthdandu2003@gmail.com',
    first_name: 'Yeshwanth',
    last_name: 'Dandu',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
] as const;

export const TEST_LISTS = [
  {
    id: '55555555-5555-5555-5555-555555555555',
    name: 'Mock Recipients',
    description: 'Seeded test list with 2 recipients',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
] as const;
