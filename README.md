# EVACS 관제 대시보드

React + TypeScript / MapLibre / deck.gl 기반 관제 화면.

## 실행

```sh
pnpm install
pnpm dev
```

기본 주소: http://localhost:5273
`/control/*`은 기본적으로 `http://localhost:8081`에 프록시한다.
실제 API 없이 UI를 확인하려면 별도 터미널에서 목 서버를 실행한다.

```sh
node mock/mock-server.mjs
```

다른 터미널:

```sh
VITE_PROXY_TARGET=http://localhost:8099 pnpm dev
```

목 차량은 기존 인천 광역 임의 좌표 데이터다. 도로에 스냅된 SUMO 차량이 아니므로 인하대 상세 화면에서는 차량이 적거나 없을 수 있다. 차선 위의 실제 차량 이동 검증은 SUMO 어댑터 → 관제 API 데이터로 해야 한다.

## 배포 — 관제서버와 같은 호스트에 도커로

대시보드는 정적 번들이고 `/control/*`은 dev에서 Vite 프록시가 넘겨준다. 정적 호스팅(예: GitHub Pages)에는 그 프록시가 없고, 페이지가 HTTPS면 HTTP 관제서버 호출이 mixed content로 차단된다. 그래서 **관제서버가 도는 호스트에서 nginx 이미지로 같이 서빙**한다. 같은 오리진이라 CORS 설정도 필요 없다.

```sh
docker build -t seoki/evacs-dashboard:latest .
docker run -d --network host \
  -e WEB_PORT=80 -e CONTROL_UPSTREAM=http://127.0.0.1:8081 \
  --name evacs_dashboard seoki/evacs-dashboard:latest
```

또는 `docker compose -f docker/compose.yml up -d --build` (같은 변수를 환경에서 읽는다).

- `CONTROL_UPSTREAM` — nginx가 `/control/`을 넘길 관제서버 주소. Docker Desktop처럼 host 네트워킹이 없는 환경에서는 `http://host.docker.internal:8081` + `-p 8080:80`.
- 빌드 시 `VITE_API_BASE_URL`을 주지 않는다. 브라우저는 같은 호스트의 `/control/*`로 보내고 nginx가 프록시한다.
- `.github/workflows/deploy-pages.yml`의 GitHub Pages 배포는 UI 확인용이다. 저장소 Variable `API_BASE_URL`(HTTPS + CORS 허용)이 없으면 데이터 조회는 실패한다.

## 인하대권 도로 상세 — 실제 3D Tiles

원본: `../../EVACS-Test/scenario-inhadae-wide/roads.net.xml` (인하대역 ~ 인하대 정문 ~ 인하대 후문 광역 시나리오).
초기 위치: 도로망 중심(126.6545, 37.449) 광역 보기. `기준 교차로`는 매소홀로 × 독배로 교통방송사거리(126.65048, 37.44540).
약 1.9km × 1.8km 범위이며 인하대학교 캠퍼스 건물은 포함하지 않는다.

- SUMO 좌표와 `netOffset`을 해석해 WGS84 → ECEF → ENU로 변환한다.
- 차로 중심선과 폭으로 노면을 만들고 교차로와 내부 연결 차로를 합친다.
- 차로 경계/점선을 메시로 포함한 `b3dm` + GLB 타일을 `Tile3DLayer`로 읽는다.
- 승용차 통행 가능 차로 2,005개(외부 703개, 내부 1,302개), 교차로 면 203개, 신호 교차로 14개.
- 단일 타일(약 2.3MB)이며 일반 베이스맵 위에 겹쳐진다. 전체를 3D 도시로 대체한 것은 아니다.
- `2D 보기 / 3D 보기`: 위에서 보기 / 45도 기울여 보기.
- `차선 상세`: 도로 타일 표시/숨김.
- `광역 보기`: 도로망 전체가 들어오는 초기 위치·배율로 복귀.
- `기준 교차로`: 교통방송사거리 확대(차량 3D 모델이 보이는 배율).
- 우클릭 드래그로 회전/기울기, 휠로 확대/축소.

## 긴급상황 위치 핀 · 차량 추적

- 접수한 긴급상황은 **목적지에 핀**이 찍히고(목적지가 없는 옛 데이터는 발생지), 생성 직후 그 위치로 카메라가 이동한다. 선택된 건은 핀이 크고 밝게, 종료된 건은 회색으로 보인다. `레이어 > 위치 핀`으로 끈다.
- 상세 패널의 `차량 추적`을 누르면 **차량뷰**(줌 18·기울기 55°)로 긴급차량을 따라간다. 중심은 보간된 표시 좌표, 방위는 진행 방향으로 서서히 수렴하며, 정지 상태에서는 화면을 돌리지 않는다. 지도 하단 배너의 `추적 해제` 또는 같은 버튼으로 끄고, 긴급상황이 종료되면 자동으로 풀린다.
- 추적 차량은 표시 영역(bbox) 밖이어도 `GET /control/vehicles/{id}`로 따로 조회해 따라간다. 좌표가 오지 않으면 배너가 `위치 신호 없음`으로 바뀐다.

## H3 셀 표시

- `레이어 > 밀도`: `GET /control/vehicles/density`의 H3 셀을 색으로 칠한다(기본 꺼짐). 셀 경계선이 있어 같은 색이 붙어도 셀 단위로 구분되고, 호버하면 H3 인덱스와 차량 수가 뜬다. 해상도는 줌에 따라 R7~R10으로 바뀌며 상태바에 `밀도 R9 · 셀 51`처럼 표시된다.
- `레이어 > 콘 영역`: 선택한 긴급상황의 `GET /control/emergencies/{id}/cone` H3 셀.
- 두 조회 모두 지도 경계(bbox)를 조건으로 쓴다. **bbox가 Store에 들어가기 전에는 조회 자체가 돌지 않아 `차량 0 · 셀 0`으로 보인다** — 지도 인스턴스가 준비될 때까지 경계 읽기를 재시도하므로, 그래도 0이면 API 응답을 먼저 확인한다.

### 정확도 한계

원본에 명시적 차로 폭이 없어 SUMO 기본 폭 3.2m를 사용한다. 차선 경계/점선은 시뮬레이션 형상을 이해하기 위한 도식이며 실제 측량된 노면표시가 아니다. 원본에 없는 건물, 횡단보도, 신호등 3D 모델, 고가도로 높이, 지형 고도를 생성하지 않는다. 노면은 WGS84 타원체 높이 0m이며 노면표시만 겹침 방지용 2cm 오프셋을 사용한다.

`public/tiles/inhadae-wide/metadata.json`에 원본 해시, 좌표계, 범위와 가정을 기록했다. 생성된 타일이 포함되어 있어 화면 실행만 할 때는 Python이 필요 없다. 외부 베이스맵은 인터넷이 필요하다.

## 도로 타일 재생성 / 검증

타일 생성 도구는 Python 3.12.8에서 검증했다. 가상환경 폴더는 커밋하지 않는다.

```sh
python3 -m venv .venv-tiles
source .venv-tiles/bin/activate
python -m pip install -r tools/requirements-sumo-tiles.txt
pnpm tiles:build
pnpm test:tiles
```

`pnpm tiles:build`은 광역 시나리오(`scenario-inhadae-wide`)를 `public/tiles/inhadae-wide/`로 변환한다.
다른 원본: `python tools/build_sumo_tiles.py --source /absolute/path/roads.net.xml --output public/tiles/<name> --longitude <lon> --latitude <lat>`
(`--longitude/--latitude`는 타일 원점이며 기본값은 교통방송사거리. `pnpm test:tiles`는 작은 `scenario-inhadae`를 기준으로 변환기 회귀를 검증한다.)
대상이 바뀌면 `src/map/InhaRoadTiles.ts`의 타일 경로와 초기 위치도 맞춰야 한다.

```sh
pnpm test
pnpm build
pnpm lint
```

프런트 테스트: 초기 위치, 타일 로딩/오류 전달, 표시 토글, StrictMode 오버레이 수명주기, 폰트 크기.
Python 테스트: 좌표 변환, 차로 폭/권한, 바이너리 포맷, 바운딩 볼륨, 결정적 재생성.

선택 사항인 `tools/verify_sumo_tiles.mjs`는 glTF Validator와 실제 loaders.gl 파서/타일 로더를 사용한다. 별도 의존성 설치 및 실행 방법은 파일 상단을 참고한다.

## 차량 3D 모델 / 부드러운 이동

- 2D, 광역 화면, 차선 상세 숨김에서는 기존 점 표시를 유지한다.
- 차선 상세를 켠 3D(기울기 1도 초과, 줌 17 이상)에서는 차체·유리·바퀴·전후등이 있는 로컬 GLB 모델을 인스턴싱한다. 긴급차량에는 별도 경광등 모델을 쓴다.
- 모델은 차량 브랜드/차종을 추정한 것이 아닌 관제용 공통 모델이다. 표시 방향은 `headingDegrees`를 따른다.
- `VehicleMotion`이 차량 ID별로 현재 표시 위치에서 새 수신 위치까지 선형 보간한다. 방위각은 359→1도처럼 최단 경로로 회전한다.
- 수신 간격(100~1500ms 범위)만큼 표시가 늦어질 수 있다. 좌표 밖으로 추측 주행하지 않고 다음 데이터가 없으면 목표 좌표에서 멈춘다.
- 재접속(5초 초과), 비정상 위치 점프, stale 좌표는 보간하지 않는다. 과거 측정 시각 패킷은 무시한다.
- 애니메이션은 `requestAnimationFrame`으로 지도 오버레이만 갱신한다. React 전체 화면을 매 프레임 재렌더하지 않으며, 이동 종료/컴포넌트 해제 시 프레임 예약을 중단한다.
- 양보 알림 링과 궤적 끝점도 같은 표시 좌표를 사용한다.
- 두 수신점 사이의 표시 보간이므로 수신 간격이 큰 급회전에서는 실제 차로 곡선을 완벽히 복원하지 않는다. 현재 DTO에는 차량별 도로/차로 ID나 중간 경로가 없다.

모델 소스와 재생성: `python3 tools/build_vehicle_models.py`. 생성된 `public/models/*.glb`가 포함되므로 일반 실행에는 재생성이 필요 없다.

## 주요 파일

- `src/components/ControlMapView.tsx`: 지도와 오버레이 수명주기, 지도 제어.
- `src/map/InhaRoadTiles.ts`: 초기 시점, 로컬 3D Tiles 레이어.
- `tools/build_sumo_tiles.py`: 재현 가능한 SUMO → 3D Tiles 변환.
- `public/tiles/inhadae-wide/`: 생성된 타일, 메타데이터, 차로 GeoJSON.
- `src/api/ControlApiClient.ts`: 실제 관제 REST API 연결 지점.
- `src/styles.css`: Pretendard Variable, 본문 16px / 보조 13~15px, 관제 패널 스타일.

Pretendard는 npm 패키지로 번들에 포함하며 외부 폰트 CDN에 의존하지 않는다.
