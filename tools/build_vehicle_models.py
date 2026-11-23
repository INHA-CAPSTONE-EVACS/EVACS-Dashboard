#!/usr/bin/env python3
"""Build original CC0 EVACS vehicles using only the Python standard library.

Meters: X width, Y up, nose -Z; origin at ground center. No downloads.
"""
import argparse
import json
from pathlib import Path
import struct


def build_model(name):
    doc = {'asset': {'version': '2.0', 'generator': 'EVACS original procedural vehicles',
                     'extras': {'license': 'CC0-1.0', 'forward': '-Z', 'up': '+Y'}},
           'scene': 0, 'scenes': [{'nodes': []}], 'nodes': [], 'meshes': [],
           'buffers': [{'byteLength': 0}], 'bufferViews': [], 'accessors': []}
    import math
    binary = bytearray()
    doc['extensionsUsed'] = ['KHR_materials_unlit']
    palette = {'body': [0.92, 0.94, 0.96, 1], 'glass': [0.19, 0.37, 0.46, 1],
               'rubber': [0.13, 0.15, 0.18, 1], 'rim': [0.6, 0.66, 0.7, 1],
               'headlamp': [1, 0.96, 0.7, 1], 'red': [1, 0.06, 0.04, 1],
               'blue': [0.04, 0.3, 1, 1], 'livery': [0.84, 0.09, 0.07, 1]}
    if name == 'sedan':
        del palette['blue']
        del palette['livery']
    # 긴급차량은 멀리서도 구분되게 차체 전체를 빨간 도장으로 간다.
    shell = 'livery' if name == 'emergency' else 'body'
    doc['materials'] = [{'name': key, 'pbrMetallicRoughness':
                          {'baseColorFactor': color, 'metallicFactor': 0, 'roughnessFactor': 1},
                         'extensions': {'KHR_materials_unlit': {}}, 'doubleSided': True}
                        for key, color in palette.items()]

    def accessor(values):
        offset = len(binary)
        for value in values:
            binary.extend(struct.pack('<fff', *value))
        view = len(doc['bufferViews'])
        doc['bufferViews'].append({'buffer': 0, 'byteOffset': offset,
                                  'byteLength': len(binary) - offset, 'target': 34962})
        result = len(doc['accessors'])
        doc['accessors'].append({'bufferView': view, 'componentType': 5126,
                                 'count': len(values), 'type': 'VEC3',
                                 'min': [min(v[i] for v in values) for i in range(3)],
                                 'max': [max(v[i] for v in values) for i in range(3)]})
        return result

    def mesh(label, vertices, faces, material):
        center = [sum(p[i] for p in vertices) / len(vertices) for i in range(3)]
        positions, normals, colors = [], [], []
        for face in faces:
            face = list(face)
            a, b, c = [vertices[i] for i in face[:3]]
            u, v = [b[i] - a[i] for i in range(3)], [c[i] - a[i] for i in range(3)]
            n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]
            length = math.sqrt(sum(x*x for x in n))
            n = [x / length for x in n]
            if sum(n[i]*(a[i]-center[i]) for i in range(3)) < 0:
                face.reverse()
                n = [-x for x in n]
            shade = 1 if material in ('headlamp', 'red', 'blue') else 0.78 + 0.22*max(0, n[1])
            for j in range(1, len(face)-1):
                positions.extend(vertices[i] for i in (face[0], face[j], face[j+1]))
                normals.extend([n]*3)
                colors.extend([(shade, shade, shade)]*3)
        primitive = {'attributes': {'POSITION': accessor(positions), 'NORMAL': accessor(normals),
                                     'COLOR_0': accessor(colors)},
                     'material': list(palette).index(material), 'mode': 4}
        index = len(doc['meshes'])
        doc['meshes'].append({'name': label, 'primitives': [primitive]})
        doc['scenes'][0]['nodes'].append(len(doc['nodes']))
        doc['nodes'].append({'name': label, 'mesh': index})

    faces = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1),
             (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]

    def box(label, low, high, material):
        x, y, z = low
        X, Y, Z = high
        mesh(label, [(x,y,z), (X,y,z), (X,Y,z), (x,Y,z),
                     (x,y,Z), (X,y,Z), (X,Y,Z), (x,Y,Z)], faces, material)

    # Closed, tapered lower hull: sloped hood, short deck, no external dependencies.
    sections = [(-2.25, .72, .68), (-1.35, .86, .93),
                (1.35, .86, .93), (2.25, .76, .78)]
    vertices = []
    for z, width, top in sections:
        vertices.extend([(-width, .28, z), (width, .28, z),
                         (width, top, z), (-width, top, z)])
    hull_faces = [(0,3,2,1), (12,13,14,15)]
    for k in range(3):
        for j in range(4):
            hull_faces.append((k*4+j, k*4+(j+1)%4, (k+1)*4+(j+1)%4, (k+1)*4+j))
    mesh('body', vertices, hull_faces, shell)
    mesh('cabin', [(-.78,.93,-1.25), (.78,.93,-1.25), (.64,1.5,-.55), (-.64,1.5,-.55),
                   (-.78,.93,1.35), (.78,.93,1.35), (.64,1.5,.65), (-.64,1.5,.65)], faces, shell)
    mesh('windshield', [(-.71,.98,-1.195), (.71,.98,-1.195),
                        (.59,1.45,-.62), (-.59,1.45,-.62)], [(0,1,2,3)], 'glass')
    mesh('rear_glass', [(-.71,.98,1.295), (.71,.98,1.295),
                        (.59,1.45,.72), (-.59,1.45,.72)], [(0,1,2,3)], 'glass')
    for sign, side in [(-1, 'left'), (1, 'right')]:
        mesh('window_'+side, [(sign*.775,.98,-1.12), (sign*.659,1.44,-.52),
                              (sign*.659,1.44,.62), (sign*.775,.98,1.2)], [(0,1,2,3)], 'glass')
        # B pillar splits the side glass.
        box('pillar_'+side, (min(sign*.785,sign*.65),.98,.05),
            (max(sign*.785,sign*.65),1.46,.12), shell)
        for z, axle in [(-1.4,'front'), (1.4,'rear')]:
            verts = []
            for x in (sign*.69, sign*.9):
                for j in range(16):
                    angle = 2*math.pi*j/16
                    verts.append((x,.32+.32*math.cos(angle),z+.32*math.sin(angle)))
            fs = [tuple(range(15,-1,-1)), tuple(range(16,32))]
            fs += [(j,(j+1)%16,(j+1)%16+16,j+16) for j in range(16)]
            mesh('wheel_'+axle+'_'+side, verts, fs, 'rubber')
            # Small metallic hub sits just inside the outermost tire face.
            x = sign*.901
            verts = [(x,.32+.16*math.cos(2*math.pi*j/12),z+.16*math.sin(2*math.pi*j/12)) for j in range(12)]
            # Keep exact 1.8 m width including hub faces.
            verts = [(sign*.9,y,zz) for _,y,zz in verts]
            mesh('hub_'+axle+'_'+side, verts, [tuple(range(12))], 'rim')
        x1, x2 = sorted((sign*.43, sign*.7))
        box('headlamp_'+side, (x1,.48,-2.25), (x2,.64,-2.21), 'headlamp')
        box('taillamp_'+side, (x1,.48,2.21), (x2,.66,2.25), 'red')
        if name == 'emergency':
            x1,x2 = sorted((sign*.861,sign*.865))
            # 빨간 차체 위에서는 흰 스트라이프가 대비를 만든다.
            box('stripe_'+side, (x1,.66,-1.3), (x2,.8,1.3), 'body')
    if name == 'emergency':
        box('lightbar_mount', (-.56,1.5,-.18), (.56,1.54,.18), 'rubber')
        box('lightbar_red', (-.58,1.54,-.17), (-.025,1.64,.17), 'red')
        box('lightbar_blue', (.025,1.54,-.17), (.58,1.64,.17), 'blue')
    return doc, binary


def write_glb(path, doc, binary):
    doc['buffers'][0]['byteLength'] = len(binary)
    text = json.dumps(doc, separators=(',', ':')).encode()
    text += b' ' * (-len(text) % 4)
    binary += b'\0' * (-len(binary) % 4)
    data = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(text) + 8 + len(binary))
    data += struct.pack('<I4s', len(text), b'JSON') + text
    data += struct.pack('<I4s', len(binary), b'BIN\0') + binary
    path.write_bytes(data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path,
                        default=Path(__file__).resolve().parents[1] / 'public/models')
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for name in ('sedan', 'emergency'):
        doc, binary = build_model(name)
        path = args.output_dir / f'{name}.glb'
        write_glb(path, doc, binary)
        print(f'{path}: {path.stat().st_size} bytes')


if __name__ == '__main__':
    main()
