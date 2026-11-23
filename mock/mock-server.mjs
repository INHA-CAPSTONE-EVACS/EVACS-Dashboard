/**
 * 관제서버 목(mock). 실제 evacs-api-server 없이 대시보드를 돌려 보려고 쓴다.
 *
 * 실행: node mock/mock-server.mjs   (기본 포트 8099)
 * 대시보드: VITE_PROXY_TARGET=http://localhost:8099 pnpm dev
 *
 * 응답 모양은 evacs-api-server의 DTO와 같게 맞춰 두었다. 값은 전부 가짜다.
 */
import http from 'node:http';
import { latLngToCell, cellToLatLng, gridDisk } from 'h3-js';

const PORT = Number(process.env.PORT || 8099);
const CENTER = { lat: 37.4563, lng: 126.6525 }; // 인천
/** SUMO 모드 긴급상황의 고정 출발 차고지(app.py DEFAULT_DEPOTS의 용현소방파출소). */
const SUMO_DEPOT = { id: 'yonghyeon', lat: 37.454087, lng: 126.648956 };
const VEHICLE_COUNT = Number(process.env.VEHICLES || 1500);
const TICK_MS = 500;

/** 차량 상태. 실제로는 ws-server가 Redis 해시에 넣는 값이다. */
const vehicles = new Map();
for (let i = 0; i < VEHICLE_COUNT; i += 1) {
  const id = `veh_${String(i).padStart(4, '0')}`;
  vehicles.set(id, {
    vehicleId: id,
    vehicleType: i % 120 === 0 ? 'EMERGENCY' : 'NORMAL',
    latitude: CENTER.lat + (Math.random() - 0.5) * 0.09,
    longitude: CENTER.lng + (Math.random() - 0.5) * 0.12,
    speedMps: 4 + Math.random() * 16,
    headingDegrees: Math.random() * 360,
    laneIndex: Math.floor(Math.random() * 3),
    laneCount: 3,
    measuredAt: new Date().toISOString(),
    occurredAt: new Date().toISOString(),
    stale: false,
  });
}

setInterval(() => {
  const now = new Date().toISOString();
  for (const v of vehicles.values()) {
    if (Math.random() < 0.02) v.headingDegrees = (v.headingDegrees + (Math.random() - 0.5) * 60 + 360) % 360;
    const rad = (v.headingDegrees * Math.PI) / 180;
    const dist = (v.speedMps * TICK_MS) / 1000 / 111_320;
    v.latitude += Math.cos(rad) * dist;
    v.longitude += (Math.sin(rad) * dist) / Math.cos((v.latitude * Math.PI) / 180);
    // 영역을 벗어나면 되돌린다
    if (Math.abs(v.latitude - CENTER.lat) > 0.06) v.headingDegrees = (v.headingDegrees + 180) % 360;
    if (Math.abs(v.longitude - CENTER.lng) > 0.08) v.headingDegrees = (v.headingDegrees + 180) % 360;
    v.stale = Math.random() < 0.004;
    v.measuredAt = now;
    v.occurredAt = now;
  }
}, TICK_MS);

/** 긴급상황 저장소. 차량당 ACTIVE 1건 제약을 실제 서버처럼 409로 막는다. */
const emergencies = new Map();
const routes = new Map();
const events = new Map();

seed();

function seed() {
  const emergencyVehicle = [...vehicles.values()].find((v) => v.vehicleType === 'EMERGENCY');
  if (emergencyVehicle) {
    create({
      vehicleId: emergencyVehicle.vehicleId,
      emergencyType: 'FIRE',
      originLat: emergencyVehicle.latitude,
      originLng: emergencyVehicle.longitude,
      destinationLat: CENTER.lat + 0.03,
      destinationLng: CENTER.lng + 0.04,
      description: '목 데이터로 만든 초기 긴급상황',
    });
  }
}

function create(dto) {
  const active = [...emergencies.values()].find(
    (e) => e.vehicleId === dto.vehicleId && e.status === 'ACTIVE',
  );
  if (active) {
    const err = new Error(`해당 차량에 이미 진행 중인 긴급상황이 있습니다: ${active.id}`);
    err.status = 409;
    throw err;
  }

  const isSumo = dto.isSumo === true;
  if (isSumo && (dto.destinationLat == null || dto.destinationLng == null)) {
    const err = new Error('SUMO 모드에서는 destinationLat, destinationLng가 필요합니다.');
    err.status = 400;
    throw err;
  }

  const id = crypto.randomUUID();
  const emergency = {
    id,
    vehicleId: dto.vehicleId,
    status: 'ACTIVE',
    emergencyType: dto.emergencyType,
    originLat: dto.originLat ?? null,
    originLng: dto.originLng ?? null,
    destinationLat: dto.destinationLat ?? null,
    destinationLng: dto.destinationLng ?? null,
    description: dto.description ?? null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    isSumo,
  };
  emergencies.set(id, emergency);

  // 출발 → 목적지 직선 경로를 20점으로 쪼갠다.
  // SUMO 모드는 발생지가 없고 출발이 시나리오 차고지라, 그 좌표를 경로 시작점으로 쓴다.
  const startLat = emergency.originLat ?? SUMO_DEPOT.lat;
  const startLng = emergency.originLng ?? SUMO_DEPOT.lng;
  const pts = [];
  const steps = 20;
  const dLat = (emergency.destinationLat ?? startLat) - startLat;
  const dLng = (emergency.destinationLng ?? startLng) - startLng;
  for (let i = 0; i <= steps; i += 1) {
    const lat = startLat + (dLat * i) / steps;
    const lng = startLng + (dLng * i) / steps;
    pts.push({
      sequence: i,
      latitude: lat,
      longitude: lng,
      h3Index: latLngToCell(lat, lng, 9),
      etaSeconds: i * 18,
    });
  }
  routes.set(id, pts);

  events.set(id, [
    {
      id: crypto.randomUUID(),
      eventType: 'EMERGENCY_CREATED',
      vehicleId: dto.vehicleId,
      payload: null,
      occurredAt: new Date().toISOString(),
    },
  ]);
  return emergency;
}

/** 진행 중인 긴급상황마다 알림 이벤트를 꾸준히 쌓는다. */
setInterval(() => {
  for (const e of emergencies.values()) {
    if (e.status !== 'ACTIVE') continue;
    const near = nearbyVehicleIds(e, 6);
    if (near.length === 0) continue;
    const log = events.get(e.id) ?? [];
    log.unshift({
      id: crypto.randomUUID(),
      eventType: 'YIELD_ALERT_SENT',
      vehicleId: near[Math.floor(Math.random() * near.length)],
      payload: null,
      occurredAt: new Date().toISOString(),
    });
    events.set(e.id, log.slice(0, 60));
  }
}, 2500);

function emergencyVehicleOf(e) {
  return vehicles.get(e.vehicleId);
}

function nearbyVehicleIds(e, ringSize) {
  const v = emergencyVehicleOf(e);
  if (!v) return [];
  const cells = new Set(gridDisk(latLngToCell(v.latitude, v.longitude, 9), ringSize));
  const out = [];
  for (const other of vehicles.values()) {
    if (other.vehicleId === v.vehicleId) continue;
    if (cells.has(latLngToCell(other.latitude, other.longitude, 9))) out.push(other.vehicleId);
  }
  return out;
}

// ---------- HTTP ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const q = url.searchParams;

  try {
    if (req.method === 'GET' && path === '/control/vehicles') {
      const list = filterVehicles(q);
      return json(res, 200, {
        count: list.length,
        vehicles: list,
        queriedAt: new Date().toISOString(),
      });
    }

    if (req.method === 'GET' && path === '/control/vehicles/summary') {
      const all = [...vehicles.values()];
      return json(res, 200, {
        total: all.length,
        normal: all.filter((v) => v.vehicleType === 'NORMAL').length,
        emergency: all.filter((v) => v.vehicleType === 'EMERGENCY').length,
        unknown: 0,
        stale: all.filter((v) => v.stale).length,
        queriedAt: new Date().toISOString(),
      });
    }

    if (req.method === 'GET' && path === '/control/vehicles/density') {
      const resolution = Number(q.get('resolution') || 9);
      const counts = new Map();
      for (const v of filterVehicles(q)) {
        const cell = latLngToCell(v.latitude, v.longitude, resolution);
        const cur = counts.get(cell) ?? { vehicleCount: 0, normalCount: 0, emergencyCount: 0 };
        cur.vehicleCount += 1;
        if (v.vehicleType === 'EMERGENCY') cur.emergencyCount += 1;
        else cur.normalCount += 1;
        counts.set(cell, cur);
      }
      const cells = [...counts.entries()].map(([h3Index, c]) => {
        const [centerLat, centerLng] = cellToLatLng(h3Index);
        return { h3Index, centerLat, centerLng, ...c };
      });
      return json(res, 200, {
        resolution,
        cellCount: cells.length,
        cells,
        queriedAt: new Date().toISOString(),
      });
    }

    if (req.method === 'GET' && path.startsWith('/control/vehicles/')) {
      const v = vehicles.get(decodeURIComponent(path.split('/').pop()));
      if (!v) return json(res, 404, { message: '차량을 찾을 수 없습니다' });
      return json(res, 200, v);
    }

    if (req.method === 'GET' && path === '/control/emergencies') {
      const status = q.get('status');
      let list = [...emergencies.values()];
      if (status) list = list.filter((e) => e.status === status);
      list.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
      return json(res, 200, { count: list.length, emergencies: list });
    }

    if (req.method === 'POST' && path === '/control/emergencies') {
      const dto = await body(req);
      if (!dto.vehicleId || !dto.emergencyType) {
        return json(res, 400, { message: 'vehicleId와 emergencyType은 필수입니다' });
      }
      return json(res, 201, create(dto));
    }

    const match = path.match(/^\/control\/emergencies\/([^/]+)(\/.*)?$/);
    if (match) {
      const [, id, sub] = match;
      const e = emergencies.get(id);
      if (!e) return json(res, 404, { message: '긴급상황을 찾을 수 없습니다' });

      if (req.method === 'GET' && !sub) return json(res, 200, e);

      if (req.method === 'GET' && sub === '/route') {
        const points = routes.get(id) ?? [];
        return json(res, 200, { emergencyId: id, pointCount: points.length, points });
      }

      if (req.method === 'GET' && sub === '/events') {
        return json(res, 200, events.get(id) ?? []);
      }

      if (req.method === 'GET' && sub === '/cone') {
        const v = emergencyVehicleOf(e);
        if (e.status !== 'ACTIVE' || !v) {
          return json(res, 200, {
            emergencyId: id,
            available: false,
            vehicleId: null,
            version: 0,
            resolution: null,
            cells: [],
            updatedAt: null,
          });
        }
        const origin = latLngToCell(v.latitude, v.longitude, 9);
        const cells = gridDisk(origin, 4).map((h3Index) => {
          const [centerLat, centerLng] = cellToLatLng(h3Index);
          return { h3Index, centerLat, centerLng };
        });
        return json(res, 200, {
          emergencyId: id,
          available: true,
          vehicleId: v.vehicleId,
          version: Date.now(),
          resolution: 9,
          cells,
          updatedAt: new Date().toISOString(),
        });
      }

      if (req.method === 'GET' && sub === '/alerted-vehicles') {
        const ids = e.status === 'ACTIVE' ? nearbyVehicleIds(e, 4) : [];
        return json(res, 200, { emergencyId: id, count: ids.length, vehicleIds: ids });
      }

      if (req.method === 'POST' && sub === '/end') {
        e.status = 'ENDED';
        e.endedAt = new Date().toISOString();
        return json(res, 200, e);
      }
    }

    return json(res, 404, { message: `no route: ${req.method} ${path}` });
  } catch (err) {
    return json(res, err.status ?? 500, { message: err.message });
  }
});

function filterVehicles(q) {
  const minLat = numOr(q.get('minLat'), -90);
  const maxLat = numOr(q.get('maxLat'), 90);
  const minLng = numOr(q.get('minLng'), -180);
  const maxLng = numOr(q.get('maxLng'), 180);
  const type = q.get('vehicleType');
  const includeStale = q.get('includeStale') === 'true';

  const out = [];
  for (const v of vehicles.values()) {
    if (v.latitude < minLat || v.latitude > maxLat) continue;
    if (v.longitude < minLng || v.longitude > maxLng) continue;
    if (type && v.vehicleType !== type) continue;
    if (!includeStale && v.stale) continue;
    out.push(v);
  }
  return out;
}

function numOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function json(res, status, payload) {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(text);
}

function body(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

server.listen(PORT, () => {
  console.log(`[mock] 관제서버 목 기동: http://localhost:${PORT}  차량 ${VEHICLE_COUNT}대`);
});
