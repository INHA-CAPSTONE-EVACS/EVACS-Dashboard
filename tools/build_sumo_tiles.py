#!/usr/bin/env python3
"""Deterministic SUMO passenger-road surfaces → georeferenced 3D Tiles 1.0.

SUMO shapes are projected XY + netOffset, NOT lon/lat. Remove netOffset,
transform using location.projParameter, then WGS84 ellipsoid → ECEF → ENU.
GLB vertices are (east, up, -north); 3D Tiles' Y-up → Z-up yields ENU.
Only road geometry is represented: no buildings, inferred terrain or extrusion.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import xml.etree.ElementTree as ET

from pyproj import CRS, Transformer
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union, substring
from shapely import constrained_delaunay_triangles


def build_geometry(network):
    """Union flat lane-width ribbons and junctions; schematic, not surveyed paint."""
    lanes = network['lanes']
    ribbons = [LineString(l['shape']).buffer(l['width']/2, cap_style=2, join_style=2) for l in lanes]
    junction = unary_union([Polygon(j['shape']).buffer(0) for j in network['junctions']])
    road = unary_union([*ribbons, junction])
    edges = {}
    for lane in lanes:
        if not lane['internal']:
            edges.setdefault(lane['edge_id'], []).append(lane)
    outer, separators = [], []
    for group in edges.values():
        group.sort(key=lambda l: l['index'])
        for i, lane in enumerate(group):
            line = LineString(lane['shape'])
            # SUMO lane indices start at the right-hand side in driving direction.
            if i == 0:
                outer.append(line.offset_curve(-lane['width']/2).buffer(0.06, cap_style=2))
            left = line.offset_curve(lane['width']/2)
            if i == len(group)-1 or group[i+1]['index'] != lane['index']+1:
                outer.append(left.buffer(0.06, cap_style=2))
            else:
                # Uniform 3 m dash / 6 m period is intentionally schematic.
                for start in range(0, math.ceil(left.length), 6):
                    if left.length > start:
                        separators.append(substring(left, start, min(start+3, left.length)).buffer(0.06, cap_style=2))
    def paint(parts):
        return unary_union(parts).difference(junction.buffer(0.3)).intersection(road)
    return dict(road_surface=road, junction_surface=junction,
                edge_markings=paint(outer), separator_markings=paint(separators),
                internal_marking_count=0)


def shape_points(text):
    return [tuple(map(float, p.split(',')[:2])) for p in text.split()]


def read_network(source):
    root = ET.parse(source).getroot()
    lanes = []
    for edge in root.findall('edge'):
        for lane in edge.findall('lane'):
            allow = lane.get('allow')
            disallow = lane.get('disallow', '').split()
            if (allow is not None and not {'all', 'passenger'}.intersection(allow.split())) or {'all', 'passenger'}.intersection(disallow):
                continue
            points = shape_points(lane.get('shape', ''))
            if len(points) < 2:
                continue
            width = float(lane.get('width', '3.2'))
            if width <= 0 or not math.isfinite(width):
                raise ValueError(f"Invalid width for {lane.get('id')}")
            lanes.append(dict(id=lane.get('id'), edge_id=edge.get('id'),
                              index=int(lane.get('index', '0')), width=width,
                              width_source='explicit' if 'width' in lane.attrib else 'SUMO default 3.2 m',
                              internal=edge.get('function') == 'internal', shape=points))
    junctions = []
    used = {l['id'] for l in lanes}
    for j in root.findall('junction'):
        points = shape_points(j.get('shape', ''))
        if len(points) >= 3 and used.intersection((j.get('incLanes', '') + ' ' + j.get('intLanes', '')).split()):
            junctions.append(dict(id=j.get('id'), shape=points))
    return dict(location=root.find('location').attrib, lanes=lanes,
                junctions=junctions, source_lane_count=len(root.findall('.//lane')))


class GeoFrame:
    def __init__(self, location, longitude, latitude):
        self.offset = tuple(map(float, location['netOffset'].split(',')))
        self.to_geo = Transformer.from_crs(CRS.from_user_input(location['projParameter']), 'EPSG:4326', always_xy=True)
        self.to_ecef = Transformer.from_crs('EPSG:4979', 'EPSG:4978', always_xy=True)
        self.origin = self.to_ecef.transform(longitude, latitude, 0)
        lon, lat = map(math.radians, (longitude, latitude))
        self.east = (-math.sin(lon), math.cos(lon), 0)
        self.north = (-math.sin(lat)*math.cos(lon), -math.sin(lat)*math.sin(lon), math.cos(lat))
        self.up = (math.cos(lat)*math.cos(lon), math.cos(lat)*math.sin(lon), math.sin(lat))
        self.transform = [v for axis in (self.east, self.north, self.up) for v in (*axis, 0)] + [*self.origin, 1]

    def lonlat(self, x, y):
        return self.to_geo.transform(x-self.offset[0], y-self.offset[1])

    def enu(self, x, y, height=0):
        lon, lat = self.lonlat(x, y)
        position = self.to_ecef.transform(lon, lat, height)
        delta = [p-o for p, o in zip(position, self.origin)]
        return tuple(sum(a*d for a, d in zip(axis, delta)) for axis in (self.east, self.north, self.up))


def json_bytes(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


def make_glb(geometry, frame):
    """Build embedded, non-indexed, Y-up glTF triangles with explicit normals."""
    binary = bytearray()
    views, accessors, meshes, nodes, enu_points = [], [], [], [], []
    cache = {}
    specs = [('road_surface', 'road_surface', 0, 0),
             ('schematic_lane_edges', 'edge_markings', 1, 0.02),
             ('schematic_lane_separators', 'separator_markings', 2, 0.02)]
    for name, key, material, lift in specs:
        positions = []
        for triangle in constrained_delaunay_triangles(geometry[key]).geoms:
            xy = list(triangle.exterior.coords)[:3]
            signed = (xy[1][0]-xy[0][0])*(xy[2][1]-xy[0][1])-(xy[1][1]-xy[0][1])*(xy[2][0]-xy[0][0])
            if abs(signed) < 1e-12:
                continue
            if signed < 0:
                xy.reverse()
            for x, y in xy:
                cache_key = (x,y,lift)
                if cache_key not in cache:
                    east, north, up = frame.enu(x,y,lift)
                    cache[cache_key] = struct.unpack('<3f', struct.pack('<3f', east,up,-north))
                p = cache[cache_key]
                positions.append(p)
                enu_points.append((p[0],-p[2],p[1]))
        if not positions:
            continue
        attributes = {}
        for attr, values in [('POSITION', positions), ('NORMAL', [(0,1,0)]*len(positions))]:
            offset = len(binary)
            for p in values:
                binary.extend(struct.pack('<3f', *p))
            views.append(dict(buffer=0, byteOffset=offset, byteLength=len(binary)-offset, target=34962))
            accessor = dict(bufferView=len(views)-1, componentType=5126, count=len(values), type='VEC3')
            if attr == 'POSITION':
                accessor.update(min=[min(p[i] for p in positions) for i in range(3)],
                                max=[max(p[i] for p in positions) for i in range(3)])
            accessors.append(accessor)
            attributes[attr] = len(accessors)-1
        nodes.append(dict(mesh=len(meshes), name=name))
        meshes.append(dict(name=name, extras=dict(schematic=material != 0),
                           primitives=[dict(attributes=attributes, material=material, mode=4)]))
    if not enu_points:
        raise ValueError('Source contains no triangulatable passenger roads')
    materials = []
    for name, color in [('asphalt', [0.16,0.18,0.20,1]),
                        ('schematic white edges', [0.86,0.87,0.82,1]),
                        ('schematic white separators', [0.92,0.92,0.85,1])]:
        materials.append(dict(name=name, doubleSided=True,
                              pbrMetallicRoughness=dict(baseColorFactor=color, metallicFactor=0, roughnessFactor=1)))
    doc = dict(asset=dict(version='2.0', generator='EVACS deterministic SUMO road converter'),
               scene=0, scenes=[dict(nodes=list(range(len(nodes))))], nodes=nodes,
               meshes=meshes, materials=materials, accessors=accessors, bufferViews=views,
               buffers=[dict(byteLength=len(binary))])
    js = json_bytes(doc)
    # GLB is 4-byte aligned; choose JSON padding so entire b3dm is 8-byte aligned.
    js += b' ' * ((4-len(js)) % 8)
    length = 12+8+len(js)+8+len(binary)
    glb = (struct.pack('<4sII', b'glTF',2,length) + struct.pack('<II',len(js),0x4E4F534A) + js
           + struct.pack('<II',len(binary),0x004E4942) + binary)
    return glb, enu_points, sum(a['count']//3 for a in accessors if 'min' in a)


def convert(source, output, longitude=126.65048, latitude=37.44540):
    source, output = Path(source), Path(output)
    network = read_network(source)
    frame = GeoFrame(network['location'], longitude, latitude)
    geometry = build_geometry(network)
    glb, points, triangle_count = make_glb(geometry, frame)
    feature = json_bytes(dict(BATCH_LENGTH=0))
    feature += b' ' * ((-(28+len(feature))) % 8)
    b3dm = struct.pack('<4s6I', b'b3dm',1,28+len(feature)+len(glb),len(feature),0,0,0) + feature + glb
    low = [min(p[i] for p in points) for i in range(3)]
    high = [max(p[i] for p in points) for i in range(3)]
    mid = [(a+b)/2 for a,b in zip(low, high)]
    half = [(b-a)/2+0.001 for a,b in zip(low, high)]
    box = [*mid, half[0],0,0, 0,half[1],0, 0,0,half[2]]
    tileset = dict(asset=dict(version='1.0', gltfUpAxis='Y', generator='EVACS SUMO road converter'),
                   geometricError=0, root=dict(boundingVolume=dict(box=box), transform=frame.transform,
                   geometricError=0, refine='ADD', content=dict(uri='roads.b3dm')))
    minx,miny,maxx,maxy = geometry['road_surface'].bounds
    corners = [frame.lonlat(x,y) for x in (minx,maxx) for y in (miny,maxy)]
    lanes = network['lanes']
    metadata = dict(
        center=dict(latitude=latitude, longitude=longitude, height=0),
        bounds=dict(west=min(p[0] for p in corners), south=min(p[1] for p in corners),
                    east=max(p[0] for p in corners), north=max(p[1] for p in corners)),
        source=dict(file=source.name, sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                    lane_count=network['source_lane_count'], location=network['location']),
        lane_count=len(lanes), external_lane_count=sum(not l['internal'] for l in lanes),
        internal_lane_count=sum(l['internal'] for l in lanes),
        junction_count=len(network['junctions']),
        lane_filter='SUMO passenger permissions (allow/disallow); internal connections included',
        lane_width_default_m=3.2, explicit_width_lane_count=sum(l['width_source']=='explicit' for l in lanes),
        markings=dict(surveyed=False, label='Schematic lane boundaries derived from SUMO centerlines and lane widths; not surveyed road paint',
                      width_m=0.12, separator_dash_m=3, separator_period_m=6,
                      internal_lane_markings=False, render_lift_m=0.02),
        elevation=dict(datum='WGS84 ellipsoid', ground_height_m=0,
                       note='No surveyed elevation or terrain; zero ellipsoid-height road surface, no extrusion'),
        buildings=False, tile_count=1, triangle_count=triangle_count,
        road_area_m2=geometry['road_surface'].area,
        junction_area_m2=geometry['junction_surface'].area,
        coordinates=dict(tile='local ENU', gltf='east, up, -north (Y-up)',
                         transform='WGS84 ECEF; column-major ENU-to-ECEF root transform', enu_min=low, enu_max=high),
        files=dict(tileset='tileset.json', content='roads.b3dm', lanes='lanes.geojson'),
        format='3D Tiles 1.0 b3dm / embedded glTF 2.0',
        provenance_notes=['Source scenario README supplies focus junction coordinates.',
                          'Counts are computed from the actual XML, not the older scenario README.',
                          'One tile for this approximately 1 km network; no artificial buildings or heights.'])
    features = []
    for lane in lanes:
        properties = {k:v for k,v in lane.items() if k != 'shape'}
        features.append(dict(type='Feature', id=lane['id'], properties=properties,
                             geometry=dict(type='LineString', coordinates=[list(frame.lonlat(x,y)) for x,y in lane['shape']])))
    output.mkdir(parents=True, exist_ok=True)
    (output/'roads.b3dm').write_bytes(b3dm)
    for name, value in [('tileset.json',tileset), ('metadata.json',metadata),
                        ('lanes.geojson',dict(type='FeatureCollection', features=features))]:
        (output/name).write_text(json.dumps(value, indent=2, sort_keys=True, allow_nan=False)+'\n')
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path,
                        default=Path(__file__).resolve().parents[3]/'EVACS-Test/scenario-inhadae/roads.net.xml',
                        help='SUMO roads.net.xml (default: sibling EVACS-Test scenario)')
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1]/'public/tiles/inhadae')
    parser.add_argument('--longitude', type=float, default=126.65048)
    parser.add_argument('--latitude', type=float, default=37.44540)
    args = parser.parse_args()
    result = convert(args.source, args.output, args.longitude, args.latitude)
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
