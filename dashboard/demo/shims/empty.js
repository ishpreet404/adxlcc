// Node-only modules (http, dgram, child_process, pg, Gemini SDK…) are absent in the browser demo.
module.exports = {
  exec: (cmd, cb) => cb && cb(new Error('not available in demo')),
  createSocket: () => ({ on() {}, bind() {}, send() {}, close() {}, setBroadcast() {}, address: () => ({}) }),
  hostname: () => 'browser-demo', platform: () => 'browser', arch: () => 'wasm', loadavg: () => [0, 0, 0],
  networkInterfaces: () => ({}), cpus: () => [], totalmem: () => 0, freemem: () => 0
};
