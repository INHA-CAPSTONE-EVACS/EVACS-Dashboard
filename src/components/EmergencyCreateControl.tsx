/**
 * 지도에서 목적지를 선택해 SUMO 긴급상황 생성·종료 (설계서 EmergencyCreateControl).
 *
 * 설계서 함수: enterSelectMode(), submit(CreateEmergencyDto), end(emergencyId).
 * **출발 차고지는 SUMO 시나리오에 고정**(서버 `EVACS_SUMO_DEPOT_ID`)이므로 관제에서는 목적지만 지정한다.
 * 요청은 항상 `isSumo: true`이고, 서버가 커밋 후 시뮬레이터에 이 차량 ID로 긴급차량 1대를 투입한다.
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

export function EmergencyCreateControl({ onCreated }: Props) {
  const selectMode = useDashboardStore((s) => s.selectMode);
  const enterSelectMode = useDashboardStore((s) => s.enterSelectMode);
  const exitSelectMode = useDashboardStore((s) => s.exitSelectMode);
  const pickedPoint = useDashboardStore((s) => s.pickedPoint);
  const clearPickedPoint = useDashboardStore((s) => s.clearPickedPoint);

  const [vehicleId, setVehicleId] = useState('');
  const [emergencyType, setEmergencyType] = useState(EMERGENCY_TYPES[0]);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);

  const canSubmit = vehicleId.trim().length > 0 && pickedPoint !== null && !submitting;

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
    <Panel
      title="긴급상황 접수"
      actions={
        <button
          type="button"
          className={`btn${selectMode ? ' is-on' : ''}`}
          onClick={() => (selectMode ? exitSelectMode() : enterSelectMode())}
        >
          {selectMode ? '선택 취소' : '지도에서 목적지 지정'}
        </button>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!pickedPoint) return;
          void submit({
            vehicleId: vehicleId.trim(),
            emergencyType,
            // 출발지는 SUMO 시나리오 차고지로 고정 — 지도에서 고른 지점은 목적지다.
            destinationLat: pickedPoint.latitude,
            destinationLng: pickedPoint.longitude,
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

        <label className="field">
          <span>출발</span>
          <output className="field__output">SUMO 시나리오 차고지(고정)</output>
        </label>

        <label className="field">
          <span>목적지</span>
          <output className="mono field__output">
            {pickedPoint
              ? `${pickedPoint.latitude.toFixed(5)}, ${pickedPoint.longitude.toFixed(5)}`
              : '미지정'}
          </output>
        </label>

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
