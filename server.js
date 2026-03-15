require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

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
  expires: { type: Date, required: true, expires: 0 }   // TTL index, dokumen akan otomatis dihapus setelah expires
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

function toLuaTable(str) {
  const codes = [];
  for (let i = 0; i < str.length; i++) {
    codes.push(str.charCodeAt(i));
  }
  return '{' + codes.join(',') + '}';
}

// ========== Endpoint ==========

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

    // Buat loader dengan URL dinamis
    const loader = `loadstring(game:HttpGet("${req.protocol}://${req.get('host')}/loader/${name}"))()`;
    res.json({ success: true, loader, message: 'Script berhasil dibuat' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 2. Loader (mengembalikan dua stage loader yang sudah di‑escape)
app.get('/loader/:name', async (req, res) => {
  const name = req.params.name;
  const scriptDoc = await Script.findOne({ name });
  if (!scriptDoc) return res.status(404).send('Script not found');

  // Generate token sekali pakai
  const token = Math.random().toString(36).substring(2, 15) +
                Math.random().toString(36).substring(2, 15);
  const key = `${name}:${token}`;
  const expires = new Date(Date.now() + 30000); // 30 detik

  // Simpan token ke MongoDB
  await Token.create({ key, expires });

  const combined = encodeCombined(name, token);

  // Generate nama variabel acak
  const v = {
    rs: randomVar(),  // ReplicatedStorage
    to: randomVar(),  // tokenObj
    tk: randomVar(),  // token value
    ur: randomVar(),  // url
    sc: randomVar(),  // scriptContent
    fn: randomVar(),  // function
    er: randomVar(),  // error
    bd: randomVar(),  // base64 decode
    d: randomVar(),   // decoded
    sid: randomVar(), // scriptId
    tok: randomVar(), // token
    u: randomVar(),   // final url
    hf: randomVar(),  // hash function
    hc: randomVar(),  // computed hash
    hs: randomVar(),  // received hash
    sd: randomVar(),  // string decoder
    gs: randomVar(),  // GetService
    rsName: randomVar(), // ReplicatedStorage string
    sv: randomVar(),  // StringValue
    nm: randomVar(),  // Name
    vl: randomVar(),  // Value
    pr: randomVar(),  // Parent
    ffc: randomVar(), // FindFirstChild
    dst: randomVar(), // Destroy
  };

  // Template token maker
  const tokenMakerTemplate = `
local ${v.sd}=function(t) local r='' for i=1,#t do r=r..string.char(t[i]) end return r end
local ${v.gs}=${v.sd}(${toLuaTable("GetService")})
local ${v.rsName}=${v.sd}(${toLuaTable("ReplicatedStorage")})
local ${v.sv}=${v.sd}(${toLuaTable("StringValue")})
local ${v.nm}=${v.sd}(${toLuaTable("Name")})
local ${v.vl}=${v.sd}(${toLuaTable("Value")})
local ${v.pr}=${v.sd}(${toLuaTable("Parent")})
local ${v.rs}=game:${v.gs}(${v.rsName})
local ${v.to}=Instance.new(${v.sv})
${v.to}[${v.nm}]="${name}"
${v.to}[${v.vl}]="${token}"
${v.to}[${v.pr}]=${v.rs}
`;

  // Template real script (menggunakan URL dinamis)
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const realScriptTemplate = `
-- Hash function
local ${v.hf}=function(s) local h=0 for i=1,#s do h=(h*31+string.byte(s,i))%2^32 end return string.format("%08x",h) end
-- Base64 decode
local ${v.bd}=function(s) local b='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/' s=s:gsub('[^'..b..'=]','') return (s:gsub('.',function(x) if x=='=' then return '' end local r,f='',(b:find(x)-1) for i=6,1,-1 do r=r..(f%2^i-f%2^(i-1)>0 and '1' or '0') end return r end):gsub('%d%d%d?%d?%d?%d?%d?%d?',function(x) if #x~=8 then return '' end local c=0 for i=1,8 do c=c+(x:sub(i,i)=='1' and 2^(8-i) or 0) end return string.char(c) end)) end
-- String decoder
local ${v.sd}=function(t) local r='' for i=1,#t do r=r..string.char(t[i]) end return r end
local ${v.gs}=${v.sd}(${toLuaTable("GetService")})
local ${v.rsName}=${v.sd}(${toLuaTable("ReplicatedStorage")})
local ${v.ffc}=${v.sd}(${toLuaTable("FindFirstChild")})
local ${v.dst}=${v.sd}(${toLuaTable("Destroy")})
local ${v.nm}=${v.sd}(${toLuaTable("Name")})
local ${v.vl}=${v.sd}(${toLuaTable("Value")})

-- Decode combined dari URL
local ${v.d}=${v.bd}("${combined}")
local ${v.sid},${v.tok}=${v.d}:match("([^:]+):(.+)")
local ${v.rs}=game:${v.gs}(${v.rsName})
local ${v.to}=${v.rs}:${v.ffc}(${v.sid})
if not ${v.to} then error("E1") end
if ${v.to}[${v.vl}]~=${v.tok} then error("E1") end

-- Ambil data dari server (format: hash:script)
local ${v.u}="${baseUrl}/raw/${combined}"
local ${v.sc}=game:HttpGet(${v.u})
if ${v.sc}=="invalid" then error("E2") end

-- Pisahkan hash dan script
local colon=${v.sc}:find(":")
if not colon then error("E3") end
local ${v.hs}=${v.sc}:sub(1,colon-1)
local scriptStr=${v.sc}:sub(colon+1)

-- Hitung hash dari script yang diterima
local ${v.hc}=${v.hf}(scriptStr)
if ${v.hc}~=${v.hs} then error("E4") end

-- Eksekusi
local ${v.fn},${v.er}=loadstring(scriptStr)
if not ${v.fn} then error("E5") end
pcall(${v.fn})

-- Hapus token
${v.to}:${v.dst}()
`;

  const escaped1 = escapeToBackslash(tokenMakerTemplate);
  const escaped2 = escapeToBackslash(realScriptTemplate);

  res.send(`loadstring("${escaped1}")()\nloadstring("${escaped2}")()`);
});

// 3. Raw endpoint (mengembalikan hash:script)
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

  // Hapus token (sekali pakai)
  await Token.deleteOne({ key });

  const scriptDoc = await Script.findOne({ name });
  if (!scriptDoc) return res.send('invalid');

  const hash = simpleHash(scriptDoc.script);
  res.send(`${hash}:${scriptDoc.script}`);
});

// 4. Baca script asli (untuk edit)
app.get('/:id', async (req, res) => {
  const id = req.params.id;
  const { key } = req.query;
  const scriptDoc = await Script.findOne({ name: id });
  if (!scriptDoc) return res.status(404).send('Script not found');
  if (scriptDoc.key !== key) return res.status(403).send('Invalid key');
  res.send(scriptDoc.script);
});

// 5. Update script
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

// ========== Jalankan Server ==========
app.listen(port, () => {
  console.log(`✅ Server berjalan di port ${port}`);
});
