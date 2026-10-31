'use strict';
/**
 * Solana tamper-proof alert anchoring (chain-of-custody for physical-security evidence).
 *
 * On every confirmed alert we hash {alert + sensor evidence} and write that hash to
 * Solana devnet. The on-chain transaction is immutable, so the audit trail of "an alert
 * fired, with this exact evidence, at this time" cannot be altered after the fact.
 * The full data stays off-chain in TigerData; only the 32-byte hash goes on-chain.
 *
 * Starts with the SPL Memo program (no custom deploy needed). If an Anchor program id is
 * configured later (anchor/ directory), swap anchorViaProgram() in.
 *
 * Degrades safely: with no SOLANA_SECRET_KEY it still computes and returns the evidence
 * hash (local proof) but marks it unanchored, so the pipeline never blocks.
 *
 * Env:
 *   SOLANA_SECRET_KEY   base58 or JSON array secret key of a funded devnet wallet
 *   SOLANA_CLUSTER      default "https://api.devnet.solana.com"
 */
const crypto = require('crypto');

let web3 = null;
try { web3 = require('@solana/web3.js'); } catch { /* sdk absent — hash-only mode */ }

const MEMO_PROGRAM_ID = 'MemoSq4gq3eR5qkaa6DdupfVTvsjNEDPnSw5uJ3eUs2'; // SPL Memo v2
const CLUSTER = (process.env.SOLANA_CLUSTER || 'https://api.devnet.solana.com').trim();
const SECRET = (process.env.SOLANA_SECRET_KEY || '').trim();

let connection = null;
let keypair = null;
let enabled = false;
let lastError = null;

function init() {
  if (!web3 || !SECRET) {
    console.log('[solana] disabled (no SOLANA_SECRET_KEY / sdk) — evidence hashing only');
    return false;
  }
  try {
    keypair = loadKeypair(SECRET);
    connection = new web3.Connection(CLUSTER, 'confirmed');
    enabled = true;
    console.log('[solana] devnet anchoring enabled, wallet', keypair.publicKey.toBase58());
    return true;
  } catch (err) {
    lastError = err.message;
    console.warn('[solana] init failed, evidence hashing only:', err.message);
    return false;
  }
}

function loadKeypair(secret) {
  if (secret.startsWith('[')) {
    return web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)));
  }
  // base58
  const bs58 = require('bs58');
  return web3.Keypair.fromSecretKey(bs58.decode(secret));
}

/** Deterministic hash of the evidence that will be anchored. */
function evidenceHash(alert, ctx = {}) {
  const payload = {
    id: alert.id, t: alert.t, node: alert.nodeId, severity: alert.severity, kind: alert.kind,
    targetClass: alert.targetClass, probability: alert.probability,
    ml: ctx.ml ? { label: ctx.ml.label, confidence: ctx.ml.confidence } : null,
    position: ctx.position ? { x: ctx.position.x, y: ctx.position.y } : null,
    wave: ctx.telemetry && ctx.telemetry.wave ? ctx.telemetry.wave.a && ctx.telemetry.wave.a.slice(0, 32) : null
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/**
 * Anchor an alert on-chain. Returns { hash, anchored, signature?, slot?, explorer? }.
 * Never throws — anchoring failure must not break alerting.
 */
async function anchorAlert(alert, ctx = {}) {
  const hash = evidenceHash(alert, ctx);
  if (!enabled) return { hash, anchored: false };
  try {
    const memo = `CCKD|${alert.id}|${hash}`;
    const tx = new web3.Transaction().add(new web3.TransactionInstruction({
      keys: [{ pubkey: keypair.publicKey, isSigner: true, isWritable: true }],
      programId: new web3.PublicKey(MEMO_PROGRAM_ID),
      data: Buffer.from(memo, 'utf8')
    }));
    const signature = await web3.sendAndConfirmTransaction(connection, tx, [keypair], { commitment: 'confirmed' });
    const slot = (await connection.getSignatureStatus(signature)).context.slot;
    return {
      hash, anchored: true, signature, slot,
      explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet`
    };
  } catch (err) {
    lastError = err.message;
    console.warn('[solana] anchor failed:', err.message);
    return { hash, anchored: false, error: err.message };
  }
}

async function status() {
  const s = { enabled, cluster: CLUSTER, wallet: enabled ? keypair.publicKey.toBase58() : null, lastError };
  if (enabled) {
    try { s.balanceSol = (await connection.getBalance(keypair.publicKey)) / web3.LAMPORTS_PER_SOL; } catch { /* ignore */ }
  }
  return s;
}

module.exports = { init, evidenceHash, anchorAlert, status, get enabled() { return enabled; } };
