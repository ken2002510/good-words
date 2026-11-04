'use strict';
// GET/POST /api/wall — Vercel 入口（app/ 為專案根）。先 prepare 再載 handler。
require('./_bundle.js').prepare();
module.exports = require('../../deploy/api/wall.js');
