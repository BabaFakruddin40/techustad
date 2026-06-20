require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const express    = require('express');
const path       = require('path');
const https      = require('https');
const fs         = require('fs');
const session    = require('express-session');
const passport   = require('passport');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const rateLimit  = require('express-rate-limit');
const helmet     = require('helmet');
const cors       = require('cors');

const GoogleStrategy  = require('passport-google-oauth20').Strategy;
const GitHubStrategy  = require('passport-github2').Strategy;
const OAuth2Strategy  = require('passport-oauth2');

const db = require('./db');

// ── Optional third-party services (gracefully degrade if not configured) ──
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  twilioClient = require('twilio')(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
}

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'techustad-dev-secret-change-in-production';

// ── Security & Middleware ──────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  // Production: enable full security with HTTPS enforcement
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'", "'unsafe-inline'", 'https://js.stripe.com'],
        styleSrc:   ["'self'", "'unsafe-inline'"],
        frameSrc:   ["'self'", 'https://js.stripe.com'],
        connectSrc: ["'self'", 'https://api.stripe.com'],
        imgSrc:     ["'self'", 'data:', 'https:'],
      },
    },
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
  }));
} else {
  // Development: allow HTTPS localhost with self-signed certs
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'", 'https://localhost:3000', 'http://localhost:3000'],
        scriptSrc:  ["'self'", "'unsafe-inline'", 'https://js.stripe.com'],
        styleSrc:   ["'self'", "'unsafe-inline'"],
        frameSrc:   ["'self'", 'https://js.stripe.com'],
        connectSrc: ["'self'", 'https://localhost:3000', 'http://localhost:3000', 'https://api.stripe.com'],
        imgSrc:     ["'self'", 'data:', 'https:', 'http:'],
      },
    },
    hsts: false,  // Disable HSTS for self-signed dev certs
  }));
}
app.use(cors({ origin: process.env.APP_URL || true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// ── Session ────────────────────────────────────────────────────────────────
const SQLiteStore = require('connect-sqlite3')(session);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
app.use(session({
  store: new SQLiteStore({
    db:  'sessions.db',
    dir: DATA_DIR,
  }),
  secret: process.env.SESSION_SECRET || 'techustad-session-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure:   true,  // Always use secure cookies for HTTPS (dev and prod)
    httpOnly: true,
    maxAge:   7 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
  },
}));

// ── Passport ───────────────────────────────────────────────────────────────
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    done(null, user || false);
  } catch (err) {
    done(err);
  }
});

async function findOrCreateOAuthUser({ provider, providerId, email, name, avatar }) {
  let user = await db.prepare(
    'SELECT * FROM users WHERE provider = ? AND provider_id = ?'
  ).get(provider, providerId);

  if (!user && email) {
    user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (user) {
      await db.prepare(
        'UPDATE users SET provider = ?, provider_id = ?, avatar = ?, updated_at = datetime("now") WHERE id = ?'
      ).run(provider, providerId, avatar || user.avatar, user.id);
      return await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    }
  }

  if (!user) {
    const result = await db.prepare(`
      INSERT INTO users (email, full_name, avatar, provider, provider_id, email_verified)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(email || null, name || 'Unknown', avatar || null, provider, providerId);
    user = await db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastID);
  }

  return user;
}

// ── Google OAuth ──────────────────────────────────────────────────────────
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:  `${process.env.APP_URL || ''}/auth/google/callback`,
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const user = await findOrCreateOAuthUser({
        provider: 'google', providerId: profile.id,
        email:  profile.emails?.[0]?.value,
        name:   profile.displayName,
        avatar: profile.photos?.[0]?.value,
      });
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }));
}

// ── GitHub OAuth ──────────────────────────────────────────────────────────
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  passport.use(new GitHubStrategy({
    clientID:     process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackURL:  `${process.env.APP_URL || ''}/auth/github/callback`,
    scope: ['user:email'],
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const user = await findOrCreateOAuthUser({
        provider: 'github', providerId: String(profile.id),
        email:  profile.emails?.[0]?.value,
        name:   profile.displayName || profile.username,
        avatar: profile.photos?.[0]?.value,
      });
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }));
}

// ── Instagram OAuth (Meta Basic Display API) ──────────────────────────────
if (process.env.INSTAGRAM_CLIENT_ID && process.env.INSTAGRAM_CLIENT_SECRET) {
  passport.use('instagram', new OAuth2Strategy({
    authorizationURL: 'https://api.instagram.com/oauth/authorize',
    tokenURL:         'https://api.instagram.com/oauth/access_token',
    clientID:         process.env.INSTAGRAM_CLIENT_ID,
    clientSecret:     process.env.INSTAGRAM_CLIENT_SECRET,
    callbackURL:      `${process.env.APP_URL || ''}/auth/instagram/callback`,
    scope:            ['user_profile'],
  }, async (accessToken, refreshToken, params, done) => {
    try {
      const resp = await fetch(
        `https://graph.instagram.com/me?fields=id,username&access_token=${accessToken}`
      );
      const profile = await resp.json();
      const user = await findOrCreateOAuthUser({
        provider: 'instagram', providerId: String(profile.id),
        name: profile.username,
      });
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }));
}

// ── Rate limiters ─────────────────────────────────────────────────────────
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const otpLimiter  = rateLimit({ windowMs: 60 * 60 * 1000, max: 50,  standardHeaders: true, legacyHeaders: false });

// ── OTP helpers ────────────────────────────────────────────────────────────
function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function saveOTP(contact, type) {
  await db.prepare('DELETE FROM otp_codes WHERE contact = ? AND type = ?').run(contact, type);
  const code      = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await db.prepare(
    'INSERT INTO otp_codes (contact, type, code, expires_at) VALUES (?, ?, ?, ?)'
  ).run(contact, type, code, expiresAt);
  return code;
}

async function verifyOTP(contact, type, code) {
  const record = await db.prepare(
    'SELECT * FROM otp_codes WHERE contact = ? AND type = ? AND used = 0 ORDER BY id DESC LIMIT 1'
  ).get(contact, type);
  if (!record)               return { ok: false, reason: 'No OTP found' };
  if (record.attempts >= 5)  return { ok: false, reason: 'Too many attempts' };
  if (new Date(record.expires_at) < new Date()) return { ok: false, reason: 'OTP expired' };
  await db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').run(record.id);
  if (record.code !== code)  return { ok: false, reason: 'Invalid code' };
  await db.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').run(record.id);
  return { ok: true };
}

// ── JWT helpers ────────────────────────────────────────────────────────────
function issueToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  const token = req.headers.authorization?.split(' ')[1];
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      // For async database calls, use .then() for middleware
      db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub).then(user => {
        if (user) {
          req.user = user;
          next();
        } else {
          res.status(401).json({ error: 'Unauthorized' });
        }
      }).catch(err => res.status(401).json({ error: 'Unauthorized' }));
      return; // Don't fall through
    } catch { /* invalid token */ }
  }
  res.status(401).json({ error: 'Unauthorized' });
}

function sanitizeUser(user) {
  const { password_hash, ...safe } = user;
  return safe;
}

// ═══════════════════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ═══════════════════════════════════════════════════════════════════════════

app.post('/auth/register', authLimiter, async (req, res) => {
  const { email, password, full_name } = req.body;
  if (!email || !password || !full_name)
    return res.status(400).json({ error: 'All fields are required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Invalid email address' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const passwordHash = await bcrypt.hash(password, 12);
  const result = await db.prepare(
    'INSERT INTO users (email, password_hash, full_name, provider) VALUES (?, ?, ?, ?)'
  ).run(email, passwordHash, full_name.trim(), 'local');

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastID);
  req.login(user, err => {
    if (err) return res.status(500).json({ error: 'Session error' });
    res.json({ ok: true, token: issueToken(user), user: sanitizeUser(user) });
  });
});

app.post('/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !user.password_hash)
    return res.status(401).json({ error: 'Invalid email or password' });
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' });
  req.login(user, err => {
    if (err) return res.status(500).json({ error: 'Session error' });
    res.json({ ok: true, token: issueToken(user), user: sanitizeUser(user) });
  });
});

app.post('/auth/logout', (req, res) => {
  req.logout(err => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    req.session.destroy();
    res.json({ ok: true });
  });
});

app.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

// Google
app.get('/auth/google',
  (req, res, next) => {
    if (!process.env.GOOGLE_CLIENT_ID)
      return res.redirect('/?auth_error=Google+OAuth+not+configured');
    next();
  },
  passport.authenticate('google', { scope: ['profile', 'email'] })
);
app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/?auth_error=google_failed' }),
  (req, res) => res.redirect(`/?auth_success=1&token=${issueToken(req.user)}`)
);

// GitHub
app.get('/auth/github',
  (req, res, next) => {
    if (!process.env.GITHUB_CLIENT_ID)
      return res.redirect('/?auth_error=GitHub+OAuth+not+configured');
    next();
  },
  passport.authenticate('github', { scope: ['user:email'] })
);
app.get('/auth/github/callback',
  passport.authenticate('github', { failureRedirect: '/?auth_error=github_failed' }),
  (req, res) => res.redirect(`/?auth_success=1&token=${issueToken(req.user)}`)
);

// Instagram
app.get('/auth/instagram',
  (req, res, next) => {
    if (!process.env.INSTAGRAM_CLIENT_ID)
      return res.redirect('/?auth_error=Instagram+OAuth+not+configured');
    next();
  },
  passport.authenticate('instagram')
);
app.get('/auth/instagram/callback',
  passport.authenticate('instagram', { failureRedirect: '/?auth_error=instagram_failed' }),
  (req, res) => res.redirect(`/?auth_success=1&token=${issueToken(req.user)}`)
);

// Phone OTP
app.post('/auth/phone/send-otp', otpLimiter, async (req, res) => {
  const { phone } = req.body;
  const normalized = (phone || '').replace(/[\s\-()]/g, '');
  if (!normalized || !/^\+?[1-9]\d{7,14}$/.test(normalized))
    return res.status(400).json({ error: 'Invalid phone number. Use international format e.g. +1234567890' });

  const code = await saveOTP(normalized, 'phone');

  if (twilioClient) {
    try {
      await twilioClient.messages.create({
        body: `Your TechUstad code: ${code}. Valid 10 min.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to:   normalized,
      });
    } catch (err) {
      console.error('Twilio error:', err.message);
      return res.status(500).json({ error: 'Failed to send SMS. Please try again.' });
    }
    return res.json({ ok: true, message: 'OTP sent to your phone' });
  }

  // Dev mode — return code in response
  console.log(`[DEV OTP] ${normalized} → ${code}`);
  return res.json({ ok: true, message: 'OTP generated (dev mode)', dev: { code } });
});

app.post('/auth/phone/verify-otp', authLimiter, async (req, res) => {
  const { phone, code } = req.body;
  if (!phone || !code) return res.status(400).json({ error: 'Phone and code required' });
  const normalized = phone.replace(/[\s\-()]/g, '');
  const result = await verifyOTP(normalized, 'phone', code);
  if (!result.ok) return res.status(400).json({ error: result.reason });

  let user = await db.prepare('SELECT * FROM users WHERE phone = ?').get(normalized);
  if (!user) {
    const ins = await db.prepare(
      'INSERT INTO users (phone, provider, phone_verified) VALUES (?, ?, 1)'
    ).run(normalized, 'phone');
    user = await db.prepare('SELECT * FROM users WHERE id = ?').get(ins.lastID);
  } else {
    await db.prepare('UPDATE users SET phone_verified = 1, updated_at = datetime("now") WHERE id = ?').run(user.id);
    user = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  }

  req.login(user, err => {
    if (err) return res.status(500).json({ error: 'Session error' });
    res.json({ ok: true, token: issueToken(user), user: sanitizeUser(user) });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  PAYMENT ROUTES
// ═══════════════════════════════════════════════════════════════════════════

const COURSE_PRICES = {
  'Kubernetes (CKA)':         4999,
  'DevOps & CI/CD':           4999,
  'Terraform & IaC':          3999,
  'Docker & Containers':      2999,
  'Cloud Computing':          4999,
  'Python for DevOps':        2999,
  'Networking Fundamentals':  2999,
  'DevSecOps':                5999,
};

app.get('/api/payment/prices', (req, res) => res.json({ prices: COURSE_PRICES }));

app.post('/api/payment/create-intent', requireAuth, async (req, res) => {
  const { course } = req.body;
  if (!COURSE_PRICES[course]) return res.status(400).json({ error: 'Invalid course' });

  if (!stripe) {
    return res.json({ clientSecret: 'demo_' + uuidv4(), amount: COURSE_PRICES[course], demo: true });
  }

  try {
    let customerId = req.user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email:    req.user.email || undefined,
        name:     req.user.full_name || undefined,
        metadata: { userId: String(req.user.id) },
      });
      customerId = customer.id;
      db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(customerId, req.user.id);
    }
    const intent = await stripe.paymentIntents.create({
      amount:   COURSE_PRICES[course],
      currency: 'usd',
      customer: customerId,
      metadata: { userId: String(req.user.id), course },
      automatic_payment_methods: { enabled: true },
    });
    res.json({ clientSecret: intent.client_secret, amount: intent.amount });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: 'Payment service error' });
  }
});

app.post('/api/payment/confirm', requireAuth, (req, res) => {
  const { course, paymentIntentId } = req.body;
  if (!COURSE_PRICES[course]) return res.status(400).json({ error: 'Invalid course' });

  const existing = db.prepare(
    'SELECT * FROM enrollments WHERE user_id = ? AND course = ?'
  ).get(req.user.id, course);
  if (existing) return res.json({ ok: true, enrolled: course, alreadyEnrolled: true });

  const payment = db.prepare(
    'INSERT INTO payments (user_id, stripe_payment_intent_id, amount, currency, status, course) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, paymentIntentId || ('demo_' + uuidv4()), COURSE_PRICES[course], 'usd', 'succeeded', course);

  db.prepare(
    'INSERT INTO enrollments (user_id, course, payment_id) VALUES (?, ?, ?)'
  ).run(req.user.id, course, payment.lastInsertRowid);

  res.json({ ok: true, enrolled: course });
});

app.get('/api/payment/enrollments', requireAuth, (req, res) => {
  const enrollments = db.prepare(
    'SELECT * FROM enrollments WHERE user_id = ? ORDER BY enrolled_at DESC'
  ).all(req.user.id);
  res.json({ enrollments });
});

app.post('/api/payment/webhook',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.sendStatus(200);
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object;
      const { userId, course } = intent.metadata;
      const pmt = db.prepare(
        'INSERT OR IGNORE INTO payments (user_id, stripe_payment_intent_id, amount, currency, status, course) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(userId, intent.id, intent.amount, intent.currency, 'succeeded', course);
      if (pmt.changes > 0) {
        db.prepare('INSERT INTO enrollments (user_id, course, payment_id) VALUES (?, ?, ?)')
          .run(userId, course, pmt.lastInsertRowid);
      }
    }
    res.sendStatus(200);
  }
);

// ═══════════════════════════════════════════════════════════════════════════
//  SUPPORT / CUSTOMER CHANNEL ROUTES
// ═══════════════════════════════════════════════════════════════════════════

app.post('/api/support/ticket', authLimiter, (req, res) => {
  const { name, email, subject, message, priority } = req.body;
  if (!name || !email || !subject || !message)
    return res.status(400).json({ error: 'All fields are required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Invalid email address' });
  const validPriorities = ['low', 'medium', 'high'];
  const ticketPriority  = validPriorities.includes(priority) ? priority : 'medium';

  const result = db.prepare(
    'INSERT INTO support_tickets (user_id, name, email, subject, message, priority) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.user?.id || null, name.trim(), email, subject.trim(), message.trim(), ticketPriority);

  db.prepare(
    'INSERT INTO support_messages (ticket_id, sender, message) VALUES (?, ?, ?)'
  ).run(result.lastInsertRowid, 'user', message.trim());

  const ticket = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ok: true, ticket: { id: ticket.id, subject: ticket.subject, status: ticket.status } });
});

app.get('/api/support/tickets', requireAuth, (req, res) => {
  const tickets = db.prepare(
    'SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC'
  ).all(req.user.id);
  res.json({ tickets });
});

app.get('/api/support/ticket/:id', requireAuth, (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  if (!Number.isInteger(ticketId)) return res.status(400).json({ error: 'Invalid ticket id' });
  const ticket = db.prepare(
    'SELECT * FROM support_tickets WHERE id = ? AND user_id = ?'
  ).get(ticketId, req.user.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  const messages = db.prepare(
    'SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY created_at ASC'
  ).all(ticket.id);
  res.json({ ticket, messages });
});

app.post('/api/support/ticket/:id/reply', requireAuth, (req, res) => {
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message required' });
  const ticketId = parseInt(req.params.id, 10);
  if (!Number.isInteger(ticketId)) return res.status(400).json({ error: 'Invalid ticket id' });
  const ticket = db.prepare(
    'SELECT * FROM support_tickets WHERE id = ? AND user_id = ?'
  ).get(ticketId, req.user.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  db.prepare(
    'INSERT INTO support_messages (ticket_id, sender, message) VALUES (?, ?, ?)'
  ).run(ticket.id, 'user', message.trim());
  db.prepare(
    'UPDATE support_tickets SET status = "open", updated_at = datetime("now") WHERE id = ?'
  ).run(ticket.id);
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'techustad-web',
    features: {
      google_auth:    !!process.env.GOOGLE_CLIENT_ID,
      github_auth:    !!process.env.GITHUB_CLIENT_ID,
      instagram_auth: !!process.env.INSTAGRAM_CLIENT_ID,
      sms_otp:        !!twilioClient,
      stripe:         !!stripe,
    },
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Start Server with TLS/HTTPS ────────────────────────────────────────────
const certPath = path.join(__dirname, '../cert.pem');
const keyPath  = path.join(__dirname, '../key.pem');

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  // HTTPS mode - certificates exist
  const httpsOptions = {
    cert: fs.readFileSync(certPath),
    key:  fs.readFileSync(keyPath),
  };
  https.createServer(httpsOptions, app).listen(PORT, () => {
    console.log(`🔒 TechUstad server running on https://localhost:${PORT}`);
    console.log(
      `Features: Google=${!!process.env.GOOGLE_CLIENT_ID} ` +
      `GitHub=${!!process.env.GITHUB_CLIENT_ID} ` +
      `Instagram=${!!process.env.INSTAGRAM_CLIENT_ID} ` +
      `Twilio=${!!twilioClient} Stripe=${!!stripe}`
    );
  });
} else {
  // HTTP mode - fallback if no certificates
  app.listen(PORT, () => {
    console.log(`⚠️  TechUstad server running on http://localhost:${PORT} (no TLS)`);
    console.log(`    To enable HTTPS, generate certificates:`);
    console.log(`    openssl req -x509 -newkey rsa:2048 -nodes -out cert.pem -keyout key.pem -days 365 -subj "/CN=localhost"`);
    console.log(
      `Features: Google=${!!process.env.GOOGLE_CLIENT_ID} ` +
      `GitHub=${!!process.env.GITHUB_CLIENT_ID} ` +
      `Instagram=${!!process.env.INSTAGRAM_CLIENT_ID} ` +
      `Twilio=${!!twilioClient} Stripe=${!!stripe}`
    );
  });
}
