import React from "react";

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground px-6 py-12">
      <div className="max-w-4xl mx-auto">
        <h1 className="serif text-4xl mb-4">Developer Documentation</h1>
        <p className="text-muted mb-6">Quickstart guides, API reference, and examples.</p>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-2">Send an email</h2>
          <pre className="bg-surface-muted p-4 rounded text-sm overflow-x-auto">{`POST /v1/send

{
  "from": "marketing@yourdomain.in",
  "to": "customer@example.com",
  "subject": "Welcome",
  "format": "html",
  "body": "<h1>Hello</h1>"
}
`}</pre>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-2">Authentication</h2>
          <p className="text-sm text-muted">Use a bearer token provided in your account dashboard: <code>Authorization: Bearer &lt;token&gt;</code></p>
        </section>
      </div>
    </div>
  );
}
