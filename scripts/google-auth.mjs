// Service-account OAuth for the Google APIs, without the googleapis package.
// GDRIVE_SA_KEY = the service account's JSON key; files must be shared with
// its client_email.
import { createSign } from 'node:crypto';

export async function getAccessToken(scope) {
  const raw = process.env.GDRIVE_SA_KEY;
  if (!raw) throw new Error('GDRIVE_SA_KEY is not set');
  const key = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: key.client_email,
    scope,
    aud: key.token_uri,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
  const res = await fetch(key.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`token request failed: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}
