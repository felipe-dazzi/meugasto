const express = require('express');
const crypto = require('crypto');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = '/tmp/meugasto-data.json';
const DEFAULT_LIMIT = 1500;

// ── Storage ────────────────────────────────────────────
function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return { hash: null, salt: null, monthlyLimit: DEFAULT_LIMIT, expenses: [], nextId: 1 };
  }
}

function saveData(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ── Init default admin ─────────────────────────────────
(() => {
  const data = loadData();
  if (!data.hash) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync('admin123', salt, 1000, 64, 'sha512').toString('hex');
    data.hash = hash;
    data.salt = salt;
    data.monthlyLimit = data.monthlyLimit || DEFAULT_LIMIT;
    saveData(data);
    console.log('Default user created: admin / admin123');
  }
  // Ensure monthlyLimit exists on existing data
  if (!data.monthlyLimit) {
    data.monthlyLimit = DEFAULT_LIMIT;
    saveData(data);
  }
})();

// ── Middleware ─────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'meu-gasto-secret-2026',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// ── Auth ───────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

// ── Routes ─────────────────────────────────────────────
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const data = loadData();

  if (username !== 'admin') {
    return res.render('login', { error: 'Usuário ou senha inválidos' });
  }

  const hash = crypto.pbkdf2Sync(password, data.salt, 1000, 64, 'sha512').toString('hex');
  if (hash !== data.hash) {
    return res.render('login', { error: 'Usuário ou senha inválidos' });
  }

  req.session.userId = 1;
  req.session.username = 'admin';
  res.redirect('/');
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Update monthly limit
app.post('/limit', requireAuth, (req, res) => {
  const { limit } = req.body;
  const val = parseFloat(limit);
  if (val > 0 && val < 100000) {
    const data = loadData();
    data.monthlyLimit = val;
    saveData(data);
  }
  res.redirect('/');
});

// Main page
app.get('/', requireAuth, (req, res) => {
  const now = new Date();
  const year = parseInt(req.query.year) || now.getFullYear();
  const month = parseInt(req.query.month) || (now.getMonth() + 1);
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;

  const months = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  const data = loadData();
  const limit = data.monthlyLimit || DEFAULT_LIMIT;
  const expenses = data.expenses
    .filter(e => e.date.startsWith(monthStr))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

  const totalSpent = expenses.reduce((s, e) => s + e.amount, 0);
  const remaining = limit - totalSpent;
  const pct = Math.min(totalSpent / limit * 100, 100);

  const categories = ['Alimentacao','Transporte','Lazer','Assinaturas','Compras','Outros'];
  const catTotals = {};
  categories.forEach(c => {
    catTotals[c] = expenses.filter(e => e.category === c).reduce((s, e) => s + e.amount, 0);
  });

  res.render('index', {
    expenses,
    totalSpent,
    remaining,
    pct,
    month,
    year,
    monthName: months[month - 1],
    monthStr,
    categories,
    catTotals,
    MONTHLY_LIMIT: limit,
    limitEdit: limit,
    username: req.session.username
  });
});

// Add expense
app.post('/add', requireAuth, (req, res) => {
  const { amount, category, description, date } = req.body;
  const d = date || new Date().toISOString().split('T')[0];

  const data = loadData();
  const expense = {
    id: data.nextId++,
    amount: parseFloat(amount),
    category,
    description: description || '',
    date: d,
    created_at: new Date().toISOString()
  };
  data.expenses.push(expense);
  saveData(data);

  res.redirect('/');
});

// Delete expense
app.post('/delete/:id', requireAuth, (req, res) => {
  const data = loadData();
  data.expenses = data.expenses.filter(e => e.id !== parseInt(req.params.id));
  saveData(data);
  res.redirect('/');
});

// API: get month data
app.get('/api/month/:year/:month', requireAuth, (req, res) => {
  const monthStr = `${req.params.year}-${String(req.params.month).padStart(2, '0')}`;
  const data = loadData();
  const limit = data.monthlyLimit || DEFAULT_LIMIT;
  const expenses = data.expenses.filter(e => e.date.startsWith(monthStr));
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  res.json({ expenses, total, remaining: limit - total, limit });
});

// Export for Vercel
module.exports = app;

// Local dev
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`App rodando em http://localhost:${PORT}`);
  });
}