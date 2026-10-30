import test from 'node:test';
import assert from 'node:assert/strict';

test('renderTemplate fills tags, fallbacks and dotted paths', async () => {
  const { renderTemplate } = await import('../src/lib/render-template');
  const out = renderTemplate('Hi {{ first_name | there }}, your {{plan.name}} bill is {{ amount }}.{{missing}}', {
    first_name: '',
    plan: { name: 'Pro' },
    amount: '₹999',
  }, 'text');
  assert.equal(out, 'Hi there, your Pro bill is ₹999.');
});

test('renderTemplate escapes values in html mode only', async () => {
  const { renderTemplate } = await import('../src/lib/render-template');
  const vars = { name: '<b>Sam</b> & co' };
  assert.equal(renderTemplate('<p>{{name}}</p>', vars, 'html'), '<p>&lt;b&gt;Sam&lt;/b&gt; &amp; co</p>');
  assert.equal(renderTemplate('{{name}}', vars, 'text'), '<b>Sam</b> & co');
});

test('templateTags and hasMergeTags find the tags a template uses', async () => {
  const { templateTags, hasMergeTags } = await import('../src/lib/render-template');
  assert.deepEqual(templateTags('Hi {{first_name}}', '<p>{{ company | you }} {{first_name}}</p>', null), ['company', 'first_name']);
  assert.equal(hasMergeTags('no tags {here}'), false);
  assert.equal(hasMergeTags('Hi {{ first_name | there }}'), true);
});

test('htmlToText keeps link targets and drops markup', async () => {
  const { htmlToText } = await import('../src/lib/render-template');
  const text = htmlToText('<style>p{}</style><h1>Bill</h1><p>Total &amp; tax</p><a href="https://x.in/b.pdf">Download</a><ul><li>One</li></ul>');
  assert.equal(text, 'Bill\nTotal & tax\nDownload (https://x.in/b.pdf)- One');
});

test('contactVariables merges attributes under the built-in fields', async () => {
  const { contactVariables } = await import('../src/lib/render-template');
  const vars = contactVariables({ email: 'a@b.in', first_name: 'Asha', last_name: 'Rao', attributes: { company: 'Acme', email: 'spoof' } }, 'a@b.in');
  assert.equal(vars.full_name, 'Asha Rao');
  assert.equal(vars.company, 'Acme');
  assert.equal(vars.email, 'a@b.in');
});
