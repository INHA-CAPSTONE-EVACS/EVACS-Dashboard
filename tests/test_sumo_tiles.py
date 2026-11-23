"""Real-source regression tests; run with the tools/requirements-sumo-tiles.txt env."""
import importlib.util
from pathlib import Path
import math
import xml.etree.ElementTree as ET
import json
import struct
import subprocess
import sys

import pytest

APP = Path(__file__).resolve().parents[1]
SOURCE = APP.parents[1] / 'EVACS-Test/scenario-inhadae/roads.net.xml'
MODULE = APP / 'tools/build_sumo_tiles.py'


def converter():
    assert MODULE.exists(), 'SUMO converter is not implemented'
    spec = importlib.util.spec_from_file_location('sumo_to_tiles', MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_real_source_projection_permissions_and_widths():
    c = converter()
    network = c.read_network(SOURCE)
    raw = ET.parse(SOURCE).getroot()
    assert network['source_lane_count'] == len(raw.findall('.//lane')) == 890
    assert network['lanes']
    for lane in network['lanes']:
        source = next(x for x in raw.findall('.//lane') if x.get('id') == lane['id'])
        assert 'passenger' in source.get('allow', 'passenger').split() or 'all' in source.get('allow', '').split()
        assert 'passenger' not in source.get('disallow', '').split()
        assert lane['width'] == float(source.get('width', '3.2'))
        assert lane['width'] > 0
    assert any(l['internal'] for l in network['lanes'])
    frame = c.GeoFrame(network['location'], 126.65048, 37.44540)
    focus = next(j for j in raw.findall('junction') if j.get('id') == 'cluster_11257934915_11257934916_2886789172_436830040')
    lon, lat = frame.lonlat(float(focus.get('x')), float(focus.get('y')))
    assert lon == pytest.approx(126.65048, abs=0.0003)
    assert lat == pytest.approx(37.44540, abs=0.0003)
    enu = frame.enu(float(focus.get('x')), float(focus.get('y')))
    assert math.hypot(*enu[:2]) < 35
    assert abs(enu[2]) < 0.01
    # True ECEF rotation/translation: tile transform must recover ground point.
    x, y = network['lanes'][0]['shape'][0]
    local = frame.enu(x, y)
    t = frame.transform
    ecef = [sum(t[col*4+row] * local[col] for col in range(3)) + t[12+row] for row in range(3)]
    lon, lat = frame.lonlat(x, y)
    expected = c.Transformer.from_crs('EPSG:4979', 'EPSG:4978', always_xy=True).transform(lon, lat, 0)
    assert ecef == pytest.approx(expected, abs=1e-6)


def test_geometry_has_full_width_roads_junctions_and_schematic_markings():
    from shapely.geometry import LineString, Point
    c = converter()
    network = c.read_network(SOURCE)
    geometry = c.build_geometry(network)
    assert geometry['road_surface'].is_valid
    assert geometry['road_surface'].area > 10000
    assert geometry['junction_surface'].area > 1000
    assert geometry['edge_markings'].area > 0
    assert geometry['separator_markings'].area > 0
    assert geometry['internal_marking_count'] == 0
    for lane in network['lanes']:
        ribbon = LineString(lane['shape']).buffer(lane['width']/2, cap_style=2, join_style=2)
        assert ribbon.difference(geometry['road_surface']).area < 1e-6
    assert geometry['edge_markings'].difference(geometry['road_surface']).area < 1e-6
    assert geometry['separator_markings'].difference(geometry['road_surface']).area < 1e-6
    # Width must come from the source rather than a fixed display pixel width.
    tiny = dict(lanes=[dict(id='road_0', edge_id='road', index=0, width=6,
                            internal=False, shape=[(0,0),(20,0)])], junctions=[])
    straight = c.build_geometry(tiny)
    assert straight['road_surface'].area == pytest.approx(120)
    assert straight['road_surface'].bounds == pytest.approx((0,-3,20,3))


def test_generated_b3dm_glb_axes_bounds_and_reproducibility(tmp_path):
    c = converter()
    output = tmp_path / 'tiles'
    metadata = c.convert(SOURCE, output)
    tileset = json.loads((output/'tileset.json').read_text())
    assert tileset['asset']['version'] == '1.0'
    assert tileset['asset']['gltfUpAxis'] == 'Y'
    root = tileset['root']
    data = (output/root['content']['uri']).read_bytes()
    magic, version, total, ftj, ftb, btj, btb = struct.unpack_from('<4s6I', data)
    assert (magic, version, total) == (b'b3dm', 1, len(data))
    assert len(data) % 8 == 0
    assert json.loads(data[28:28+ftj]) == {'BATCH_LENGTH': 0}
    start = 28+ftj+ftb+btj+btb
    assert start % 8 == 0
    glb = data[start:]
    assert struct.unpack_from('<4sII', glb) == (b'glTF', 2, len(glb))
    jlen, jtype = struct.unpack_from('<II', glb, 12)
    assert jtype == 0x4E4F534A
    doc = json.loads(glb[20:20+jlen])
    blen, btype = struct.unpack_from('<II', glb, 20+jlen)
    binary = glb[28+jlen:]
    assert btype == 0x004E4942 and len(binary) == blen
    assert 0 <= blen-doc['buffers'][0]['byteLength'] <= 3
    assert [m['name'] for m in doc['meshes']] == ['road_surface', 'schematic_lane_edges', 'schematic_lane_separators']
    assert all(m['extras']['schematic'] for m in doc['meshes'][1:])
    all_enu = []
    for mesh in doc['meshes']:
        for primitive in mesh['primitives']:
            a = doc['accessors'][primitive['attributes']['POSITION']]
            view = doc['bufferViews'][a['bufferView']]
            assert view['byteOffset'] % 4 == 0
            count = a['count']
            assert a['componentType'] == 5126 and a['type'] == 'VEC3'
            points = [struct.unpack_from('<3f', binary, view['byteOffset']+i*12) for i in range(count)]
            assert count % 3 == 0 and count > 0
            for axis in range(3):
                assert a['min'][axis] == pytest.approx(min(p[axis] for p in points), abs=1e-4)
                assert a['max'][axis] == pytest.approx(max(p[axis] for p in points), abs=1e-4)
            for p in points:
                assert all(math.isfinite(v) for v in p)
                e, u, neg_n = p
                assert abs(u) < 0.2
                all_enu.append((e,-neg_n,u))
            for i in range(0,count,3):
                a,b,d = points[i:i+3]
                up = (b[2]-a[2])*(d[0]-a[0])-(b[0]-a[0])*(d[2]-a[2])
                assert up >= -0.0001
    box = root['boundingVolume']['box']
    for p in all_enu:
        assert all(abs(p[i]-box[i]) <= box[3+i*4]+0.001 for i in range(3))
    assert metadata['center'] == {'latitude':37.44540, 'longitude':126.65048, 'height':0}
    assert metadata['lane_count'] == len(c.read_network(SOURCE)['lanes'])
    assert metadata['source']['lane_count'] == 890
    assert metadata['markings']['surveyed'] is False
    assert metadata['buildings'] is False
    bounds = metadata['bounds']
    assert 126.63 < bounds['west'] < bounds['east'] < 126.67
    assert 37.43 < bounds['south'] < bounds['north'] < 37.46
    features = json.loads((output/'lanes.geojson').read_text())['features']
    assert len(features) == metadata['lane_count']
    snapshot = {p.name:p.read_bytes() for p in output.iterdir()}
    c.convert(SOURCE, output)
    assert snapshot == {p.name:p.read_bytes() for p in output.iterdir()}


def test_cli_default_source_is_independent_of_cwd(tmp_path):
    result = subprocess.run([sys.executable, str(MODULE), '--output', str(tmp_path/'out')],
                            cwd=tmp_path, text=True, capture_output=True)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)['source']['lane_count'] == 890
    assert (tmp_path/'out/tileset.json').is_file()
