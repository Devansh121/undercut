import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const VALID_DAYS = 397;
const RENEW_BEFORE_MS = 30 * 24 * 3600 * 1000;

function hasOpenssl() {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function withOpenssl(dir, altNames) {
  const san = altNames.map((n) => (/^\d+\.\d+\.\d+\.\d+$/.test(n) ? `IP:${n}` : `DNS:${n}`));
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-sha256',
      '-days',
      String(VALID_DAYS),
      '-keyout',
      path.join(dir, 'key.pem'),
      '-out',
      path.join(dir, 'cert.pem'),
      '-subj',
      '/CN=Local game server',
      '-addext',
      `subjectAltName=${san.join(',')}`,
      '-addext',
      'basicConstraints=critical,CA:FALSE',
      '-addext',
      'extendedKeyUsage=serverAuth',
    ],
    { stdio: 'ignore' },
  );
}

async function withNode(dir, altNames) {
  const { generate } = await import('selfsigned');
  const pems = await generate([{ name: 'commonName', value: 'Local game server' }], {
    keySize: 2048,
    notAfterDate: new Date(Date.now() + VALID_DAYS * 24 * 3600 * 1000),
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: altNames.map((n) =>
          /^\d+\.\d+\.\d+\.\d+$/.test(n) ? { type: 7, ip: n } : { type: 2, value: n },
        ),
      },
    ],
  });
  fs.writeFileSync(path.join(dir, 'key.pem'), pems.private, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'cert.pem'), pems.cert);
}

/**
 * Return `{ key, cert, generated, generator }` for a self-signed certificate covering
 * `altNames`, cached in `dir`. Regenerated when the names change or expiry is near.
 * Uses the openssl CLI when present, else pure JS. Set CERT_GENERATOR=node to force JS.
 */
export async function ensureCert(dir, altNames) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const metaPath = path.join(dir, 'meta.json');
  const names = [...new Set(altNames)].sort();
  let meta = null;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    // No cached certificate yet.
  }
  const fresh =
    meta &&
    JSON.stringify(meta.names) === JSON.stringify(names) &&
    meta.expires - Date.now() > RENEW_BEFORE_MS &&
    fs.existsSync(path.join(dir, 'key.pem')) &&
    fs.existsSync(path.join(dir, 'cert.pem'));

  let generator = meta?.generator ?? 'cached';
  if (!fresh) {
    generator = process.env.CERT_GENERATOR !== 'node' && hasOpenssl() ? 'openssl' : 'node';
    if (generator === 'openssl') withOpenssl(dir, names);
    else await withNode(dir, names);
    fs.chmodSync(path.join(dir, 'key.pem'), 0o600);
    const expires = Date.now() + VALID_DAYS * 24 * 3600 * 1000;
    fs.writeFileSync(metaPath, JSON.stringify({ names, expires, generator }, null, 2));
  }
  return {
    key: fs.readFileSync(path.join(dir, 'key.pem')),
    cert: fs.readFileSync(path.join(dir, 'cert.pem')),
    generated: !fresh,
    generator,
  };
}
