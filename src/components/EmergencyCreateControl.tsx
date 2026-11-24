/**
 * 지도에서 출발지·목적지를 선택해 SUMO 긴급상황 생성 (설계서 EmergencyCreateControl).
 *
 * 설계서 함수: enterSelectMode(), submit(CreateEmergencyDto), end(emergencyId).
 * 요청은 항상 `isSumo: true`이고, 서버가 커밋 후 시뮬레이터에 이 차량 ID로 긴급차량 1대를 투입한다.
 * **출발지는 두 가지다** — 기본은 SUMO 시나리오 차고지(서버 `EVACS_SUMO_DEPOT_ID`)이고,
 * 좌표를 찍으면 `originLat/originLng`로 보내 시뮬레이터가 그 좌표를 도로에 붙여 출발시킨다.
 * 서버가 거절(이미 진행 중인 긴급상황 존재 등)하면 사유를 그대로 표시한다.
 */
import { useState } from 'react';
import { ControlApiClient, ControlApiError } from '../api/ControlApiClient';
import type { CreateEmergencyDto, EmergencyResponse } from '../api/contracts';
import { useDashboardStore } from '../store/DashboardStore';
import { EMERGENCY_TYPES, emergencyTypeLabel } from '../utils/format';
import { Panel } from './Panel';

interface Props {
  /** 생성 성공 시 결과를 목록에 반영한다(이후 상태 변화는 목록 조회로 갱신). */
  onCreated: (created: EmergencyResponse) => void;
}

const coord = (p: { latitude: number; longitude: number } | null) =>
  p ? `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}` : '미지정';

export function EmergencyCreateControl({ onCreated }: Props) {
  const selectMode = useDashboardStore((s) => s.selectMode);
  const enterSelectMode = useDashboardStore((s) => s.enterSelectMode);
  const pickedPoints = useDashboardStore((s) => s.pickedPoints);
  const clearPickedPoint = useDashboardStore((s) => s.clearPickedPoint);

  const [vehicleId, setVehicleId] = useState('');
  const [emergencyType, setEmergencyType] = useState(EMERGENCY_TYPES[0]);
  const [description, setDescription] = useState('');
  /** 출발지를 좌표로 지정할지. false면 시나리오 차고지에서 출발한다. */
  const [originFromMap, setOriginFromMap] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);

  const origin = pickedPoints.origin;
  const destination = pickedPoints.destination;
  const originReady = !originFromMap || origin !== null;
  const canSubmit = vehicleId.trim().length > 0 && destination !== null && originReady && !submitting;

  /** 긴급상황 생성 요청. 이미 진행 중인 건이 있어 거절되면 사유 표시. */
  async function submit(dto: CreateEmergencyDto) {
    setSubmitting(true);
    setRejected(null);
    try {
      const created = await ControlApiClient.createEmergency(dto);
      onCreated(created);
      setVehicleId('');
      setDescription('');
      clearPickedPoint();
    } catch (e) {
      setRejected(
        e instanceof ControlApiError
          ? `${e.status === 409 ? '거절' : '실패'} · ${e.message}`
          : String(e),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Panel title="긴급상황 접수">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!destination || !originReady) return;
          void submit({
            vehicleId: vehicleId.trim(),
            emergencyType,
            // 출발지를 찍지 않으면 originLat/Lng를 아예 보내지 않는다 = 시나리오 차고지 출발.
            ...(originFromMap && origin
              ? { originLat: origin.latitude, originLng: origin.longitude }
              : {}),
            destinationLat: destination.latitude,
            destinationLng: destination.longitude,
            description: description.trim() || undefined,
            isSumo: true,
          });
        }}
      >
        <label className="field">
          <span>차량 번호</span>
          <input
            className="mono"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            placeholder="EVACS_EMG_CALL_001"
            maxLength={64}
          />
        </label>

        <label className="field">
          <span>유형</span>
          <select value={emergencyType} onChange={(e) => setEmergencyType(e.target.value)}>
            {EMERGENCY_TYPES.map((t) => (
              <option key={t} value={t}>
                {emergencyTypeLabel(t)}
              </option>
            ))}
          </select>
        </label>

        <div className="field">
          <span>출발</span>
          <div className="segmented segmented--tight">
            <button
              type="button"
              className={originFromMap ? '' : 'is-on'}
              aria-pressed={!originFromMap}
              onClick={() => {
                setOriginFromMap(false);
                clearPickedPoint('origin');
              }}
            >
              시나리오 차고지
            </button>
            <button
              type="button"
              className={originFromMap ? 'is-on' : ''}
              aria-pressed={originFromMap}
              onClick={() => setOriginFromMap(true)}
            >
              지도 지정
            </button>
          </div>
        </div>

        {originFromMap ? (
          <div className="field">
            <span>출발 좌표</span>
            <div className="field__pick">
              <output className="mono field__output">{coord(origin)}</output>
              <button
                type="button"
                className={`btn${selectMode === 'origin' ? ' is-on' : ''}`}
                aria-pressed={selectMode === 'origin'}
                onClick={() => enterSelectMode('origin')}
              >
                {selectMode === 'origin' ? '선택 취소' : '지도 선택'}
              </button>
            </div>
          </div>
        ) : null}

        <div className="field">
          <span>목적지</span>
          <div className="field__pick">
            <output className="mono field__output">{coord(destination)}</output>
            <button
              type="button"
              className={`btn${selectMode === 'destination' ? ' is-on' : ''}`}
              aria-pressed={selectMode === 'destination'}
              onClick={() => enterSelectMode('destination')}
            >
              {selectMode === 'destination' ? '선택 취소' : '지도 선택'}
            </button>
          </div>
        </div>

        <label className="field">
          <span>비고</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="선택 입력"
          />
        </label>

        {rejected ? <p className="form__error">{rejected}</p> : null}

        <button type="submit" className="btn btn--primary" disabled={!canSubmit}>
          {submitting ? '접수 중' : '접수'}
        </button>
      </form>
    </Panel>
  );
}
