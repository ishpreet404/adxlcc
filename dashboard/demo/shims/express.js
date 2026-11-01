// Just enough of Express to run the server's routers in the page: method + path matching,
// :params, middleware chains, req.query/body, res.status/json.
function compile(path) {
  const keys = [];
  const src = path.replace(/\/$/, '').replace(/:([A-Za-z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; });
  return { re: new RegExp(`^${src || ''}/?$`), keys };
}
function Router() {
  const layers = [];
  const add = (method) => (path, ...fns) => { layers.push({ method, ...compile(path), fns: fns.flat() }); return router; };
  const router = {
    layers,
    get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE'),
    use(prefix, ...fns) {
      if (typeof prefix !== 'string') { fns.unshift(prefix); prefix = ''; }
      for (const f of fns) if (f && f.layers) layers.push({ mount: prefix.replace(/\/$/, ''), router: f });
      return router;
    },
    find(method, path) {
      for (const l of layers) {
        if (l.router) {
          if (path === l.mount || path.startsWith(l.mount + '/')) {
            const hit = l.router.find(method, path.slice(l.mount.length) || '/');
            if (hit) return hit;
          }
          continue;
        }
        if (l.method !== method) continue;
        const m = l.re.exec(path);
        if (m) return { fns: l.fns, params: Object.fromEntries(l.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
      }
      return null;
    }
  };
  return router;
}
function express() { const app = Router(); app.disable = app.set = () => {}; return app; }
express.Router = Router;
express.json = express.urlencoded = () => (req, res, next) => next();
express.static = () => (req, res, next) => next();
module.exports = express;
