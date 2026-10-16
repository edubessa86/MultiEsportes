// Cria o .env com um JWT_SECRET aleatório (não sobrescreve se já existir).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

if (existsSync('.env')) {
  console.log('.env já existe — nada a fazer.');
  process.exit(0);
}
const example = readFileSync('.env.example', 'utf8');
const secret = randomBytes(48).toString('base64');
writeFileSync('.env', example.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${secret}`), { mode: 0o600 });
console.log('.env criado com um JWT_SECRET novo.');
