/** Optional end-to-end loader check, without changing app dependencies.
 * Install @loaders.gl/3d-tiles@4.5.5 @loaders.gl/core@4.5.5
 * @deck.gl/core@9.4.1 gltf-validator@2.0.0-dev.3.10 in a scratch npm prefix.
 * SUMO_TILES_NODE_PREFIX=/path/to/prefix node tools/verify_sumo_tiles.mjs
 * Starts and closes its own loopback server. No frontend changes or WebGL needed.
 */
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const require = createRequire(process.env.SUMO_TILES_NODE_PREFIX
  ? path.join(process.env.SUMO_TILES_NODE_PREFIX, 'package.json') : import.meta.url);
const {Tiles3DLoader} = require('@loaders.gl/3d-tiles');
const {load, parse} = require('@loaders.gl/core');
const {Tileset3D} = require('@loaders.gl/tiles');
const {WebMercatorViewport} = require('@deck.gl/core');
const validator = require('gltf-validator');
const root = fileURLToPath(new URL('../public/tiles/inhadae/', import.meta.url));
const buffer = await readFile(path.join(root, 'roads.b3dm'));
const tile = await parse(buffer, Tiles3DLoader);
const start = 28 + [12,16,20,24].reduce((sum, offset) => sum+buffer.readUInt32LE(offset),0);
const report = await validator.validateBytes(new Uint8Array(buffer.subarray(start)), {maxIssues:20});
console.log('GLB validation', JSON.stringify(report.issues));
if (report.issues.numErrors || report.issues.numWarnings) throw Error('GLB validator errors/warnings');
console.log('B3dm parsed meshes', tile.gltf.meshes.length, 'rotateYtoZ', tile.rotateYtoZ);

const server = createServer(async (req,res) => {
  try {
    const name = path.basename(req.url);
    if (!['tileset.json','roads.b3dm'].includes(name)) throw Error('Unknown asset');
    const data = await readFile(path.join(root,name));
    res.setHeader('Content-Type', name.endsWith('.json') ? 'application/json' : 'application/octet-stream');
    res.end(data);
  } catch {
    res.writeHead(404); res.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let tileset;
let timer;
try {
  const url = `http://127.0.0.1:${server.address().port}/tileset.json`;
  const header = await load(url,Tiles3DLoader);
  let resolveLoad, rejectLoad, loaded = 0;
  const done = new Promise((resolve,reject) => {resolveLoad=resolve; rejectLoad=reject;});
  tileset = new Tileset3D(header, {url,
    onTileLoad: loadedTile => {
      loaded++;
      console.log('onTileLoad', loadedTile.contentUrl, 'gltfUpAxis', loadedTile.content.gltfUpAxis);
      resolveLoad();
    },
    onTileError: (_tile,message) => rejectLoad(Error(message))
  });
  const viewport = new WebMercatorViewport({width:1440,height:900,
    longitude:126.65048,latitude:37.4454,zoom:18.5,pitch:45,bearing:-24});
  timer = setTimeout(() => rejectLoad(Error('Tile load timed out')),5000);
  await tileset.selectTiles(viewport);
  await done;
  await tileset.selectTiles(viewport);
  console.log(JSON.stringify({loaded, selected:tileset.selectedTiles.length,
    cartographicCenter:tileset.cartographicCenter}));
  if (loaded !== 1 || tileset.selectedTiles.length !== 1) throw Error('Expected one loaded/selected tile');
} finally {
  clearTimeout(timer);
  tileset?.destroy();
  server.closeAllConnections();
  server.close();
}
