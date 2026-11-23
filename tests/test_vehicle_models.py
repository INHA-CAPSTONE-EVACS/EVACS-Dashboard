"""Binary-level tests for the original, locally generated EVACS vehicles."""
import json
from pathlib import Path
import struct
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]


def load_glb(path):
    data = path.read_bytes()
    magic, version, length = struct.unpack_from('<4sII', data)
    assert (magic, version, length) == (b'glTF', 2, len(data))
    size, kind = struct.unpack_from('<I4s', data, 12)
    assert kind == b'JSON'
    doc = json.loads(data[20:20 + size])
    offset = 20 + size
    binary_size, kind = struct.unpack_from('<I4s', data, offset)
    assert kind == b'BIN\x00'
    return doc, data[offset + 8:offset + 8 + binary_size]


def test_generator_produces_self_contained_deterministic_glbs(tmp_path):
    script = ROOT / 'tools/build_vehicle_models.py'
    assert script.is_file(), 'vehicle generator must exist'
    for _ in range(2):
        subprocess.run([sys.executable, str(script), '--output-dir', str(tmp_path)], check=True)
        files = {name: (tmp_path / f'{name}.glb').read_bytes() for name in ('sedan', 'emergency')}
        if _ == 0:
            first = files
        else:
            assert files == first
    for name in files:
        doc, binary = load_glb(tmp_path / f'{name}.glb')
        assert len(binary) >= doc['buffers'][0]['byteLength']
        assert all('uri' not in b for b in doc['buffers'])
        assert not doc.get('images')
        assert doc['asset']['extras']['forward'] == '-Z'
        assert doc['asset']['extras']['up'] == '+Y'
        assert doc['asset']['extras']['license'] == 'CC0-1.0'


@pytest.mark.parametrize('name,height', [('sedan', 1.5), ('emergency', 1.64)])
def test_vehicle_geometry_materials_and_ground_axes(tmp_path, name, height):
    subprocess.run([sys.executable, str(ROOT / 'tools/build_vehicle_models.py'),
                    '--output-dir', str(tmp_path)], check=True)
    doc, binary = load_glb(tmp_path / f'{name}.glb')
    nodes = {node['name']: node for node in doc['nodes']}
    required = {'body', 'cabin', 'windshield', 'rear_glass', 'window_left', 'window_right',
                'wheel_front_left', 'wheel_front_right', 'wheel_rear_left', 'wheel_rear_right',
                'headlamp_left', 'headlamp_right', 'taillamp_left', 'taillamp_right'}
    assert required <= nodes.keys()
    positions = []
    for mesh in doc['meshes']:
        for primitive in mesh['primitives']:
            acc = doc['accessors'][primitive['attributes']['POSITION']]
            view = doc['bufferViews'][acc['bufferView']]
            coords = list(struct.iter_unpack('<fff', binary[view['byteOffset']:view['byteOffset'] + view['byteLength']]))
            positions.extend(coords)
            assert len(coords) == acc['count']
            assert primitive['attributes'].get('NORMAL') is not None
    lo = [min(p[i] for p in positions) for i in range(3)]
    hi = [max(p[i] for p in positions) for i in range(3)]
    assert lo == pytest.approx([-0.9, 0, -2.25])
    assert hi == pytest.approx([0.9, height, 2.25])
    for side in ('left', 'right'):
        wheel = doc['meshes'][nodes[f'wheel_front_{side}']['mesh']]['primitives'][0]
        assert doc['accessors'][wheel['attributes']['POSITION']]['count'] >= 120
    materials = {m['name']: m for m in doc['materials']}
    assert all('KHR_materials_unlit' in m['extensions'] for m in materials.values())
    assert materials['body']['pbrMetallicRoughness']['baseColorFactor'][:3] == [0.92, 0.94, 0.96]
    body_material = doc['meshes'][nodes['body']['mesh']]['primitives'][0]['material']
    if name == 'emergency':
        assert {'stripe_left', 'stripe_right', 'lightbar_red', 'lightbar_blue'} <= nodes.keys()
        assert materials['red']['pbrMetallicRoughness']['baseColorFactor'][:3] == [1, 0.06, 0.04]
        assert materials['blue']['pbrMetallicRoughness']['baseColorFactor'][:3] == [0.04, 0.3, 1]
        # 긴급차량은 차체/캐빈이 빨간 도장이어야 멀리서도 일반차량과 구분된다.
        assert materials['livery']['pbrMetallicRoughness']['baseColorFactor'][:3] == [0.84, 0.09, 0.07]
        livery = list(materials).index('livery')
        assert body_material == livery
        assert doc['meshes'][nodes['cabin']['mesh']]['primitives'][0]['material'] == livery
        # 측면 스트라이프는 빨간 차체와 대비되는 흰색.
        assert doc['meshes'][nodes['stripe_left']['mesh']]['primitives'][0]['material'] \
            == list(materials).index('body')
    else:
        assert 'livery' not in materials
        assert body_material == list(materials).index('body')
