// A stand-in for your existing payout API: accepts every POST /payouts.
// Envoy puts PayRekha in front of it via ext_authz — no code change here.
import { createServer } from 'node:http';
createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'SENT', received: b.length, payrekha: req.headers['x-payrekha-verdict'] ?? null }));
  });
}).listen(9000, () => console.error('fake payout API on :9000'));
