/** 차량 마커/3D 모델, 수신 스냅샷 보간 및 긴급차량 궤적(설계서 VehicleLayer). */
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { ScenegraphLayer } from '@deck.gl/mesh-layers';
import type { Layer } from '@deck.gl/core';
import type { VehicleResponse } from '../api/contracts';
import { MAP_COLORS, type RGBA } from './colors';
import { VehicleMotion } from './VehicleMotion';

const TRAIL_LIMIT = 120;
export interface DiffStats { added: number; moved: number; removed: number; }

export function shouldUseVehicleModels(pitch: number, zoom: number, roadsVisible: boolean): boolean {
  return roadsVisible && pitch > 1 && zoom >= 17;
}

/** glTF: +Y=위, -Z=전방. roll90으로 ENU에 세우고 북 기준 시계방향 방위각을 적용. */
export function vehicleOrientation(v: VehicleResponse): [number, number, number] {
  return [0, v.headingDegrees === 0 ? 0 : -v.headingDegrees, 90];
}

export class VehicleLayer {
  private motion = new VehicleMotion();
  private vehicles = new Map<string, VehicleResponse>();
  private lastSnapshot: VehicleResponse[] | null = null;
  private targets = new Map<string, VehicleResponse>();
  private trails = new Map<string, [number, number][]>();
  private trailVehicleId: string | null = null;
  private version = 0;
  private lastDiff: DiffStats = { added: 0, moved: 0, removed: 0 };

  render(vehicles: VehicleResponse[]): void { this.applyDiff([], vehicles); }

  /** 배열 순서가 아닌 차량 ID로 수명과 보간을 관리한다. 중복 렌더는 재수신이 아니다. */
  applyDiff(_previous: VehicleResponse[], current: VehicleResponse[], now = performance.now()): void {
    if (current === this.lastSnapshot) return;
    this.lastSnapshot = current;
    this.motion.ingest(current, now);
    const accepted = this.motion.sample(Infinity);
    const next = new Map(accepted.map((v) => [v.vehicleId, v]));
    let added = 0, moved = 0, removed = 0;
    for (const v of accepted) {
      const old = this.targets.get(v.vehicleId);
      if (!old) added++;
      else if (old.latitude !== v.latitude || old.longitude !== v.longitude || old.headingDegrees !== v.headingDegrees) moved++;
    }
    for (const id of this.targets.keys()) {
      if (!next.has(id)) { removed++; this.trails.delete(id); }
    }
    this.targets = next;
    this.recordTrailPoints(accepted);
    this.lastDiff = { added, moved, removed };
    this.updateFrame(now);
  }

  /** React 재렌더 없이 오버레이 rAF에서 호출. 알림 조회도 같은 표시 좌표를 사용한다. */
  updateFrame(now: number): boolean {
    this.vehicles = new Map(this.motion.sample(now).map((v) => [v.vehicleId, v]));
    this.version++;
    return this.motion.hasActiveMotion(now);
  }

  renderTrail(vehicleId: string | null): void { this.trailVehicleId = vehicleId; }
  getDiffStats(): DiffStats { return this.lastDiff; }
  getVehicle(vehicleId: string): VehicleResponse | undefined { return this.vehicles.get(vehicleId); }
  lookup = (id: string): VehicleResponse | undefined => this.vehicles.get(id);

  toDeckLayers(options: { visible: boolean; showTrail: boolean; models?: boolean }): Layer[] {
    const data = [...this.vehicles.values()];
    const layers: Layer[] = [new ScatterplotLayer<VehicleResponse>({
      id: 'vehicle-layer', data, visible: options.visible && !options.models, pickable: true,
      radiusUnits: 'pixels', radiusMinPixels: 1.5, radiusMaxPixels: 7,
      getPosition: (v) => [v.longitude, v.latitude, 0.1],
      getRadius: (v) => isEmergency(v) ? 6 : 2.6,
      getFillColor: vehicleColor, stroked: false,
      updateTriggers: { getPosition: this.version, getFillColor: this.version },
    })];
    if (options.models) {
      for (const emergency of [false, true]) {
        layers.push(new ScenegraphLayer<VehicleResponse>({
          id: emergency ? 'vehicle-model-emergency' : 'vehicle-model-normal',
          data: data.filter((v) => isEmergency(v) === emergency),
          scenegraph: `${import.meta.env.BASE_URL}models/${emergency ? 'emergency' : 'sedan'}.glb`,
          visible: options.visible, pickable: true,
          getPosition: (v) => [v.longitude, v.latitude, 0.06],
          getOrientation: vehicleOrientation,
          getColor: (v) => v.stale ? [125, 125, 125, 190] : [255, 255, 255, 255],
          // flat 셰이더는 glTF 재질색/COLOR_0을 무시한다. PBR 경로에서 unlit 재질을 읽는다.
          sizeScale: 1, _lighting: 'pbr',
          updateTriggers: { getPosition: this.version, getOrientation: this.version, getColor: this.version },
        }));
      }
    }
    const trail = this.trailVehicleId ? this.trails.get(this.trailVehicleId) ?? [] : [];
    if (options.showTrail && trail.length > 0) {
      // 가장 최근 수신점(아직 화면보다 앞선 점)은 현재 표시 위치로 대체한다.
      const displayed = this.trailVehicleId ? this.lookup(this.trailVehicleId) : undefined;
      const path = trail.slice(0, -1);
      if (displayed) path.push([displayed.longitude, displayed.latitude]);
      if (path.length > 1) layers.push(new PathLayer<{ path: [number, number][] }>({
        id: 'vehicle-trail-layer', data: [{ path }], getPath: (v) => v.path,
        getColor: MAP_COLORS.trail, getWidth: 2, widthUnits: 'pixels', widthMinPixels: 2,
      }));
    }
    return layers;
  }

  private recordTrailPoints(vehicles: VehicleResponse[]): void {
    for (const v of vehicles) {
      if (!isEmergency(v)) continue;
      const points = this.trails.get(v.vehicleId) ?? [];
      const last = points[points.length - 1];
      if (!last || last[0] !== v.longitude || last[1] !== v.latitude) {
        points.push([v.longitude, v.latitude]);
        if (points.length > TRAIL_LIMIT) points.shift();
        this.trails.set(v.vehicleId, points);
      }
    }
  }
}
export function isEmergency(v: VehicleResponse): boolean { return v.vehicleType?.toUpperCase() === 'EMERGENCY'; }
function vehicleColor(v: VehicleResponse): RGBA { return v.stale ? MAP_COLORS.stale : isEmergency(v) ? MAP_COLORS.emergency : MAP_COLORS.normal; }
