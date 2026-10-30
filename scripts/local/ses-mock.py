# Minimal SES v2 stand-in for local testing: records SendEmail calls.
import json, sys, uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
LOG = sys.argv[1]
identities = {}
fail_to = set(['fail-always@acme.test'])
class H(BaseHTTPRequestHandler):
    def _send(self, code, body):
        b = json.dumps(body).encode()
        self.send_response(code); self.send_header('Content-Type','application/json')
        self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
        if self.path == '/v2/email/outbound-emails':
            to = body['Destination']['ToAddresses'][0]
            if to in fail_to:
                self.send_response(500); self.send_header('x-amzn-ErrorType','ServiceUnavailableException'); self.end_headers(); return
            with open(LOG, 'a') as f: f.write(json.dumps(body) + '\n')
            return self._send(200, {'MessageId': str(uuid.uuid4())})
        if self.path == '/v2/email/identities':
            name = body['EmailIdentity']
            if name in identities:
                self.send_response(400); self.send_header('x-amzn-ErrorType','AlreadyExistsException'); self.send_header('Content-Type','application/json'); self.end_headers(); self.wfile.write(b'{"message":"exists"}'); return
            identities[name] = True
            return self._send(200, {'IdentityType':'DOMAIN','VerifiedForSendingStatus':False,'DkimAttributes':{'Tokens':['tok1','tok2','tok3']}})
        self._send(404, {})
    def do_GET(self):
        if self.path.startswith('/v2/email/identities/'):
            return self._send(200, {'DkimAttributes': {'Status': 'SUCCESS'}, 'VerifiedForSendingStatus': True})
        self._send(404, {})
    def do_DELETE(self):
        name = self.path.rsplit('/',1)[-1]; identities.pop(name, None); self._send(200, {})
    def log_message(self, *a): pass
HTTPServer(('127.0.0.1', 4580), H).serve_forever()
