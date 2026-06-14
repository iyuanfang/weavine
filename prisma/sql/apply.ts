import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const url = process.env.DATABASE_URL ?? 'file:./prisma/dev.db';
const path = url.replace(/^file:/, '');

const db = new Database(path);
const sql = readFileSync(join(__dirname, 'fts5.sql'), 'utf8');
db.exec(sql);
console.log('FTS5 applied to', path);
db.close();
