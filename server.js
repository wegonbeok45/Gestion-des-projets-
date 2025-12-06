// server.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 4000;
const USERS_FILE = path.join(__dirname, 'users.json');
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

// ensure users.json exists
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify({}, null, 2));
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// helper to derive a display name from email localpart
function nameFromEmail(email){
  const local = String(email || '').split('@')[0] || 'user';
  // replace dots/underscores and camel-case words
  return local.split(/[\.\-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// read users and normalize older formats (array/plaintext) to object keyed by email with passwordHash
function readUsers() {
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    const parsed = JSON.parse(raw || '{}');

    // If array (old format), convert to object
    if (Array.isArray(parsed)) {
      const out = {};
      for (const u of parsed) {
        if (!u || !u.email) continue;
        const email = u.email;
        const name = u.name || nameFromEmail(email);
        let passwordHash = u.passwordHash || null;
        if (!passwordHash && u.password) {
          // sync hash for small dev files
          passwordHash = bcrypt.hashSync(String(u.password), 10);
        }
        out[email] = { name, passwordHash, createdAt: u.createdAt || new Date().toISOString() };
      }
      fs.writeFileSync(USERS_FILE, JSON.stringify(out, null, 2));
      return out;
    }

    // If object, ensure entries have passwordHash (convert plaintext if present)
    if (parsed && typeof parsed === 'object') {
      let changed = false;
      for (const [email, u] of Object.entries(parsed)) {
        if (!u) continue;
        if (!u.passwordHash && u.password) {
          // convert plaintext password to hash
          parsed[email].passwordHash = bcrypt.hashSync(String(u.password), 10);
          delete parsed[email].password;
          changed = true;
        }
        // if missing name, fill it
        if (!parsed[email].name) {
          parsed[email].name = nameFromEmail(email);
          changed = true;
        }
      }
      if (changed) fs.writeFileSync(USERS_FILE, JSON.stringify(parsed, null, 2));
      return parsed;
    }

    return {};
  } catch (e) {
    console.error('Error reading users.json:', e);
    return {};
  }
}

function writeUsers(obj) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(obj, null, 2));
}

// POST /api/signup
// NOTE: signup only needs email + password. server will derive a name.
app.post('/api/signup', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }

  const users = readUsers();
  if (users[email]) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const name = nameFromEmail(email);
  const hash = await bcrypt.hash(String(password), 10);
  users[email] = { name, passwordHash: hash, createdAt: new Date().toISOString() };
  writeUsers(users);

  const token = jwt.sign({ email, name }, JWT_SECRET, { expiresIn: '7d' });
  return res.json({ token, user: { email, name } });
});

// POST /api/login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }

  const users = readUsers();
  const user = users[email];
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  // Prefer bcrypt hash compare; if legacy plaintext remains, compare directly (dev-only)
  if (user.passwordHash) {
    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  } else if (user.password) {
    // plaintext fallback (very bad for prod; ok for quick local dev)
    if (String(password) !== String(user.password)) return res.status(401).json({ error: 'Invalid credentials' });
  } else {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
  return res.json({ token, user: { email, name: user.name } });
});

// dev-only: list users (remove if you don't want it)
app.get('/api/_dev/users', (req, res) => {
  const users = readUsers();
  res.json(users);
});

// fallback to SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Fake backend + frontend server listening at http://localhost:${PORT}`);
});
