"use strict";

const { createServer } = require("node:http");
const { createHash, randomBytes, scrypt, timingSafeEqual } = require("node:crypto");
const { promisify } = require("node:util");
const { readFileSync, mkdirSync, existsSync } = require("node:fs");
const { join } = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function option(name) {
  const at = process.argv.indexOf("--" + name);
  return at < 0 ? undefined : process.argv[at + 1];
}
const port = Number(option("port") || process.env.PORT || 3001);
const host = option("host") || process.env.HOST || "127.0.0.1";
const origin = process.env.CHAT_ORIGIN || `http://localhost:${port}`;
const allowedOrigins = new Set([origin]);
if (!process.env.CHAT_ORIGIN) allowedOrigins.add(`http://127.0.0.1:${port}`);
const secure = origin.startsWith("https://");
const cookieName = secure ? "__Host-chat_session" : "chat_session";
const sessionAge = 7 * 24 * 60 * 60;
const dataDir = process.env.CHAT_DATA_DIR || join(__dirname, "data");
mkdirSync(dataDir, { recursive: true, mode: 0o700 });

const db = new DatabaseSync(join(dataDir, "chat.sqlite"));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    salt TEXT NOT NULL, password_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
    body TEXT NOT NULL, created_at TEXT NOT NULL
  );
`);

const userByEmail = db.prepare("SELECT * FROM users WHERE email = ?");
const createUser = db.prepare("INSERT INTO users(name, email, salt, password_hash) VALUES (?, ?, ?, ?) RETURNING id, name");
const sessionUser = db.prepare("SELECT u.id, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?");
const removeSession = db.prepare("DELETE FROM sessions WHERE token_hash = ?");
const createSession = db.prepare("INSERT INTO sessions VALUES (?, ?, ?)");
const removeExpired = db.prepare("DELETE FROM sessions WHERE expires <= ?");
const gifPack = require("./public/gifs.json");
const giphyKey = process.env.GIPHY_API_KEY?.trim() || "";
const giphyBadgePath = join(__dirname, "public", "giphy-attribution.png");
const giphyBadge = existsSync(giphyBadgePath);
const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/favicon.svg", ["favicon.svg", "image/svg+xml"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ["/script.js", ["script.js", "text/javascript; charset=utf-8"]],
  ["/pickers.js", ["pickers.js", "text/javascript; charset=utf-8"]],
  ["/calls.js", ["calls.js", "text/javascript; charset=utf-8"]],
  ["/screen-share.js", ["screen-share.js", "text/javascript; charset=utf-8"]],
  ["/emoji.json", ["emoji.json", "application/json; charset=utf-8"]],
  ["/gifs.json", ["gifs.json", "application/json; charset=utf-8"]],
  ...gifPack.map(({id}) => ["/gifs/" + id + ".gif", ["gifs/" + id + ".gif", "image/gif"]]),
  ...(giphyBadge ? [["/giphy-attribution.png", ["giphy-attribution.png", "image/png"]]] : []),
].map(([route, [file, type]]) => [route, { type, bytes: readFileSync(join(__dirname, "public", file)) }]));

const deriveKey = promisify(scrypt);
const dummySalt = randomBytes(16).toString("hex");
const dummyHash = Buffer.alloc(64);
let activeHashes = 0;
const attempts = new Map();
const authWindow = 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (entry.reset <= now) attempts.delete(key);
  }
  removeExpired.run(now);
}, authWindow).unref();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function tokenHash(req) {
  const cookie = req.headers.cookie?.split(";").map(value => value.trim())
    .find(value => value.startsWith(`${cookieName}=`));
  const token = cookie?.slice(cookieName.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? hashToken(token) : "";
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function setSessionCookie(res, token, maxAge) {
  const security = secure ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${cookieName}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${security}`);
}

function signIn(req, res, user) {
  const token = randomBytes(32).toString("hex");
  removeSession.run(tokenHash(req));
  createSession.run(hashToken(token), user.id, Date.now() + sessionAge * 1000);
  setSessionCookie(res, token, sessionAge);
  json(res, 200, { user });
}

async function readJson(req, max = 8192) {
  if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json") {
    throw new HttpError(415, "Send JSON to this endpoint.");
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > max) {
      req.resume();
      throw new HttpError(413, "Request too large.");
    }
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch {
    // Return the same error for invalid JSON and non-object JSON.
  }
  throw new HttpError(400, "Invalid request.");
}

function allowAuthAttempt(req) {
  const ip = req.socket.remoteAddress;
  const now = Date.now();
  let entry = attempts.get(ip);
  if (!entry || entry.reset <= now) {
    entry = { count: 0, reset: now + authWindow };
    attempts.set(ip, entry);
  }
  if (++entry.count > 12 || activeHashes >= 4) {
    throw new HttpError(429, "Too many attempts. Try again in a minute.");
  }
}

async function passwordKey(password, salt) {
  activeHashes += 1;
  try {
    return await deriveKey(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
  } finally {
    activeHashes -= 1;
  }
}

async function authenticate(req, res, signup) {
  const data = await readJson(req);
  const name = typeof data.name === "string" ? data.name.trim() : "";
  const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
  const password = typeof data.password === "string" ? data.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
      password.length < 8 || password.length > 128) {
    throw new HttpError(400, "Enter a valid email and a password of 8–128 characters.");
  }
  if (signup && (name.length < 1 || name.length > 40)) {
    throw new HttpError(400, "Enter a display name of 1–40 characters.");
  }

  allowAuthAttempt(req);
  if (signup) {
    if (userByEmail.get(email)) throw new HttpError(409, "An account already uses this email.");
    const salt = randomBytes(16).toString("hex");
    const key = await passwordKey(password, salt);
    // Another request may have registered this address while scrypt was running.
    if (userByEmail.get(email)) throw new HttpError(409, "An account already uses this email.");
    return signIn(req, res, createUser.get(name, email, salt, key.toString("hex")));
  }

  const user = userByEmail.get(email);
  const key = await passwordKey(password, user?.salt || dummySalt);
  const matches = timingSafeEqual(key, user ? Buffer.from(user.password_hash, "hex") : dummyHash);
  if (!matches || !user) throw new HttpError(401, "Email or password is incorrect.");
  signIn(req, res, { id: user.id, name: user.name });
}

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  const route = url.pathname;
  const method = req.method;

  if (method === "GET" && assets.has(route)) {
    const { type, bytes } = assets.get(route);
    res.writeHead(200, { "Content-Type": type });
    return res.end(bytes);
  }

  if (method === "POST" && !allowedOrigins.has(req.headers.origin)) {
    throw new HttpError(403, "Open m-chat from its configured URL.");
  }

  if (method === "POST" && (route === "/api/signup" || route === "/api/login")) {
    return authenticate(req, res, route === "/api/signup");
  }

  const session = tokenHash(req);
  if (method === "POST" && route === "/api/logout") {
    removeSession.run(session);
    setSessionCookie(res, "", 0);
    return json(res, 200, {});
  }

  const user = session ? sessionUser.get(session, Date.now()) : null;
  if (method === "GET" && route === "/api/me") return json(res, 200, { user });
  if (!route.startsWith("/api/")) throw new HttpError(404, "Page not found.");
  if (!user) throw new HttpError(401, "Sign in to join the chat.");
  if (method === "GET" && route === "/api/media-config") return json(res, 200, {giphyKey: giphyBadge ? giphyKey : ""});
  const action = route.slice(5);
  const readOnly = action === "state" || action === "view" || action === "calls";
  if (method !== (readOnly ? "GET" : "POST")) throw new HttpError(405, "Method not allowed.");
  const data = readOnly ? null : await readJson(req, action.startsWith("call-") ? 40000 : 820000);
  if (!readOnly && !sessionUser.get(session, Date.now())) throw new HttpError(401, "Sign in to join the chat.");
  return json(res, 200, dispatch(action, user.id, data, url.searchParams));
}

const dispatch = require("./chat")(db, (status, message) => { throw new HttpError(status, message); });

createServer((req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob: https://*.giphy.com; connect-src 'self' https://api.giphy.com; media-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  handle(req, res).catch(error => {
    if (res.destroyed || res.writableEnded) return;
    if (error instanceof HttpError) return json(res, error.status, { error: error.message });
    console.error(error);
    json(res, 500, { error: "The chat server hit a problem. Try again." });
  });
}).listen(port, host, () => console.log(`m-chat is running at ${origin}`));
