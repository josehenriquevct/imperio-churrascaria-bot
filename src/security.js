// ── Módulo de segurança ────────────────────────────────────────
import crypto from 'crypto';
import { config } from './config.js';

// ── Rate Limiter por telefone ──────────────────────────────────
const rateLimitMap = new Map();
const JANELA_MS = 60_000;

export function verificarRateLimit(telefone) {
  const agora = Date.now();
  const limite = config.seguranca.rateLimitPorMinuto;

  if (!rateLimitMap.has(telefone)) {
    rateLimitMap.set(telefone, []);
  }

  const timestamps = rateLimitMap.get(telefone);

  while (timestamps.length && timestamps[0] < agora - JANELA_MS) {
    timestamps.shift();
  }

  if (timestamps.length >= limite) {
    return false;
  }

  timestamps.push(agora);
  return true;
}

setInterval(() => {
  const agora = Date.now();
  for (const [tel, ts] of rateLimitMap) {
    if (!ts.length || ts[ts.length - 1] < agora - 300_000) {
      rateLimitMap.delete(tel);
    }
  }
}, 120_000);

// ── Validação de webhook (HMAC) ────────────────────────────────
export function verificarWebhookToken(req) {
  if (!config.webhookToken) return true;

  const token = req.headers['x-webhook-token'] || req.headers['apikey'] || req.query?.token;
  if (!token) return false;

  const a = Buffer.from(String(token), 'utf8');
  const b = Buffer.from(String(config.webhookToken), 'utf8');
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

// ── Verificação de token da API ────────────────────────────────
export function verificarBotToken(req) {
  if (!config.botToken) return false;

  const token = req.headers['x-bot-token'];
  if (!token) return false;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(token, 'utf8'),
      Buffer.from(config.botToken, 'utf8')
    );
  } catch {
    return false;
  }
}

// ── Sanitização de input ───────────────────────────────────────
export function sanitizarMensagem(texto) {
  if (!texto || typeof texto !== 'string') return '';
  let limpo = texto.trim();
  if (limpo.length > config.seguranca.maxTamanhoMsg) {
    limpo = limpo.slice(0, config.seguranca.maxTamanhoMsg);
  }
  limpo = limpo.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return limpo;
}

// ── CORS configurável ──────────────────────────────────────────
export function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;
  const allowedOrigins = config.seguranca.corsOrigins;

  if (allowedOrigins.length > 0) {
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
  } else {
    if (!origin || origin.includes('localhost') || origin.includes('127.0.0.1')) {
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
    }
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-bot-token');
  res.setHeader('Access-Control-Max-Age', '86400');

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'");

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

// ── Middleware de log seguro ───────────────────────────────────
export function logRequest(req, res, next) {
  const { method, path } = req;
  if (path === '/' || path === '/status') return next();
  console.log(`${method} ${path} — ${req.ip || 'unknown'}`);
  next();
}
