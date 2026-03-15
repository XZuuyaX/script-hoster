require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ========== Global Error Handlers ==========
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// ========== Graceful Shutdown ==========
let server;
process.on('SIGTERM', () => {
  console.log('⚠️ Received SIGTERM, shutting down gracefully...');
  server.close(() => {
    console.log('🔒 HTTP server closed');
    mongoose.connection.close().then(() => {
      console.log('🔒 MongoDB connection closed');
      process.exit(0);
    }).catch(err => {
      console.error('Error closing MongoDB:', err);
      process.exit(1);
    });
  });
});

// ========== Koneksi MongoDB ==========
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// ========== Schema & Model ==========
const scriptSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  script: { type: String, required: true },
  key: { type: String, required: true }
});
const Script = mongoose.model('Script', scriptSchema);

const tokenSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true }, // "name:token"
  expires: { type: Date, required: true, expires: 0 }   // TTL index
});
const Token = mongoose.model('Token', tokenSchema);

// ========== Fungsi Bantu ==========
function simpleHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function escapeToBackslash(str) {
  return str.split('').map(c => '\\' + c.charCodeAt(0)).join('');
}

function randomVar() {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  return chars[Math.floor(Math.random() * chars.length)] +
         chars[Math.floor(Math.random() * chars.length)];
}

function encodeCombined(name, token) {
  return Buffer.from(`${name}:${token}`).toString('base64');
}

// ========== ENDPOINT ==========
// (Semua endpoint spesifik diletakkan SEBELUM route dinamis /:id)

// Health check
app.get('/', (req, res) => {
  res.send('Server is running');
});

// 1. Buat script baru
app.post('/create', async (req, res) => {
  const { name, script, key } = req.body;
  if (!name || !script || !key) {
    return res.status(400).json({ error: 'name, script, key required' });
  }

  try {
    const existing = await Script.findOne({ name });
    if (existing) {
      return res.status(400).json({ error: 'Nama sudah digunakan' });
    }

    const newScript = new Script({ name, script, key });
    await newScript.save();

    const loader = `loadstring(game:HttpGet("${req.protocol}://${req.get('host')}/loader/${name}"))()`;
    res.json({ success: true, loader, message: 'Script berhasil dibuat' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 2. Loader
app.get('/loader/:name', async (req, res) => {
  const name = req.params.name;
  const scriptDoc = await Script.findOne({ name });
  if (!scriptDoc) return res.status(404).send('Script not found');

  const token = Math.random().toString(36).substring(2, 15) +
                Math.random().toString(36).substring(2, 15);
  const key = `${name}:${token}`;
  const expires = new Date(Date.now() + 30000);

  await Token.create({ key, expires });

  const combined = encodeCombined(name, token);

  const v = {
    rs: randomVar(), to: randomVar(), tk: randomVar(), ur: randomVar(),
    sc: randomVar(), fn: randomVar(), er: randomVar(), bd: randomVar(),
    d: randomVar(), sid: randomVar(), tok: randomVar(), u: randomVar(),
    hf: randomVar(), hc: randomVar(), hs: randomVar()
  };

  const tokenMakerTemplate = `
local ${v.rs}=game:GetService("ReplicatedStorage")
local ${v.to}=Instance.new("StringValue")
${v.to}.Name="${name}"
${v.to}.Value="${token}"
${v.to}.Parent=${v.rs}
`;

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const realScriptTemplate = `
-- Hash function
local ${v.hf}=function(s) local h=0 for i=1,#s do h=(h*31+string.byte(s,i))%2^32 end return string.format("%08x",h) end
-- Base64 decode
local ${v.bd}=function(s) local b='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/' s=s:gsub('[^'..b..'=]','') return (s:gsub('.',function(x) if x=='=' then return '' end local r,f='',(b:find(x)-1) for i=6,1,-1 do r=r..(f%2^i-f%2^(i-1)>0 and '1' or '0') end return r end):gsub('%d%d%d?%d?%d?%d?%d?%d?',function(x) if #x~=8 then return '' end local c=0 for i=1,8 do c=c+(x:sub(i,i)=='1' and 2^(8-i) or 0) end return string.char(c) end)) end

-- Decode combined dari URL
local ${v.d}=${v.bd}("${combined}")
local ${v.sid},${v.tok}=${v.d}:match("([^:]+):(.+)")
local ${v.rs}=game:GetService("ReplicatedStorage")
local ${v.to}=${v.rs}:FindFirstChild(${v.sid})
if not ${v.to} then error("E1") end
if ${v.to}.Value~=${v.tok} then error("E1") end

-- Ambil data dari server
local ${v.u}="${baseUrl}/raw/${combined}"
local ${v.sc}=game:HttpGet(${v.u})
if ${v.sc}=="invalid" then error("E2") end

local colon=${v.sc}:find(":")
if not colon then error("E3") end
local ${v.hs}=${v.sc}:sub(1,colon-1)
local scriptStr=${v.sc}:sub(colon+1)

local ${v.hc}=${v.hf}(scriptStr)
if ${v.hc}~=${v.hs} then error("E4") end

local ${v.fn},${v.er}=loadstring(scriptStr)
if not ${v.fn} then error("E5") end
pcall(${v.fn})

${v.to}:Destroy()
`;

  const escaped1 = escapeToBackslash(tokenMakerTemplate);
  const escaped2 = escapeToBackslash(realScriptTemplate);

  res.send(`loadstring("${escaped1}")()\nloadstring("${escaped2}")()`);
});

// 3. Raw endpoint
app.get('/raw/:combined', async (req, res) => {
  const combined = req.params.combined;
  let decoded;
  try {
    decoded = Buffer.from(combined, 'base64').toString();
  } catch {
    return res.send('invalid');
  }

  const [name, token] = decoded.split(':');
  if (!name || !token) return res.send('invalid');

  const key = `${name}:${token}`;
  const tokenDoc = await Token.findOne({ key });

  if (!tokenDoc || tokenDoc.expires < new Date()) {
    return res.send('invalid');
  }

  await Token.deleteOne({ key });

  const scriptDoc = await Script.findOne({ name });
  if (!scriptDoc) return res.send('invalid');

  const hash = simpleHash(scriptDoc.script);
  res.send(`${hash}:${scriptDoc.script}`);
});

// ========== Endpoint Publik: Daftar Semua Script (hanya nama) ==========
app.get('/scripts', async (req, res) => {
  try {
    const scripts = await Script.find({}, 'name -_id');
    const names = scripts.map(s => s.name);
    res.json(names);
  } catch (err) {
    console.error('❌ Gagal mengambil daftar script:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========== Admin Endpoints (dengan password) ==========
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'xzuyaxhubscriptowner'; // default sesuai keinginan

// Middleware untuk cek password admin
function checkAdmin(req, res, next) {
  const { password } = req.query;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Dapatkan semua script beserta key (hanya untuk admin)
app.get('/admin/scripts', checkAdmin, async (req, res) => {
  try {
    const scripts = await Script.find({}, 'name key -_id');
    res.json(scripts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Dapatkan detail satu script (termasuk script) untuk admin
app.get('/admin/script/:name', checkAdmin, async (req, res) => {
  try {
    const name = req.params.name;
    const script = await Script.findOne({ name }, 'name script key -_id');
    if (!script) return res.status(404).json({ error: 'Script not found' });
    res.json(script);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Hapus script sebagai admin (tanpa key)
app.delete('/admin/script/:name', checkAdmin, async (req, res) => {
  try {
    const name = req.params.name;
    const result = await Script.deleteOne({ name });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Script not found' });
    }
    res.json({ success: true, message: 'Script deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========== ROUTE DINAMIS (untuk akses user biasa) ==========
// Semua route dengan parameter :id harus diletakkan PALING AKHIR

// Baca script asli (untuk edit) – dengan key sebagai query parameter
app.get('/:id', async (req, res) => {
  const id = req.params.id;
  const { key } = req.query;
  const scriptDoc = await Script.findOne({ name: id });
  if (!scriptDoc) return res.status(404).send('Script not found');
  if (scriptDoc.key !== key) return res.status(403).send('Invalid key');
  res.send(scriptDoc.script);
});

// Update script – dengan key di body
app.post('/:id', async (req, res) => {
  const id = req.params.id;
  const { script, key } = req.body;
  const scriptDoc = await Script.findOne({ name: id });
  if (!scriptDoc) return res.status(404).json({ error: 'Script not found' });
  if (scriptDoc.key !== key) return res.status(403).json({ error: 'Invalid key' });

  scriptDoc.script = script;
  await scriptDoc.save();
  res.json({ success: true, message: 'Script updated' });
});

// Hapus script sebagai user biasa (dengan key sebagai query parameter)
app.delete('/:id', async (req, res) => {
  const id = req.params.id;
  const { key } = req.query;
  try {
    const scriptDoc = await Script.findOne({ name: id });
    if (!scriptDoc) return res.status(404).json({ error: 'Script not found' });
    if (scriptDoc.key !== key) return res.status(403).json({ error: 'Invalid key' });

    await Script.deleteOne({ name: id });
    res.json({ success: true, message: 'Script deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========== Jalankan Server ==========
server = app.listen(port, () => {
  console.log(`✅ Server berjalan di port ${port}`);
});
