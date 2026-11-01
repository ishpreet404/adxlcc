// Minimal POSIX path for the bundled server.
const norm = (p) => {
  const out = [];
  for (const s of p.split('/')) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s); }
  return '/' + out.join('/');
};
const join = (...a) => norm(a.filter(Boolean).join('/'));
module.exports = {
  join, resolve: join, normalize: norm, sep: '/',
  basename: (p, ext) => { const b = String(p).split('/').pop(); return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; },
  dirname: (p) => norm(String(p).split('/').slice(0, -1).join('/')),
  extname: (p) => { const m = /\.[^./]*$/.exec(p); return m ? m[0] : ''; }
};
