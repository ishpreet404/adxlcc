// In-memory filesystem: the two ML models are embedded at build time; the store writes to RAM.
const files = new Map([
  ['vibration_rf.json', JSON.stringify(require('../../../server/src/ml/models/vibration_rf.json'))],
  ['fusion_lr.json', JSON.stringify(require('../../../server/src/ml/models/fusion_lr.json'))]
]);
const key = (p) => String(p).split('/').pop();
const missing = (p) => Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
module.exports = {
  readFileSync(p) { const k = key(p); if (!files.has(k)) throw missing(p); return files.get(k); },
  writeFileSync(p, d) { files.set(key(p), String(d)); },
  renameSync(a, b) { files.set(key(b), files.get(key(a))); files.delete(key(a)); },
  appendFile(p, d, cb) { files.set(key(p), (files.get(key(p)) || '') + d); cb && cb(null); },
  appendFileSync(p, d) { files.set(key(p), (files.get(key(p)) || '') + d); },
  existsSync(p) { return files.has(key(p)); },
  mkdirSync() {}, readdirSync() { return []; }, unlinkSync(p) { files.delete(key(p)); }
};
