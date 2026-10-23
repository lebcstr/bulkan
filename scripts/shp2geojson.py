"""Minimal dependency-free Shapefile (Polygon/PolyLine/Point) -> GeoJSON converter.
Usage: python3 -I shp2geojson.py <path/without/ext> <out.geojson>"""
import json, struct, sys


def read_dbf(path):
    with open(path, 'rb') as f:
        data = f.read()
    nrec, hlen, rlen = struct.unpack('<IHH', data[4:12])
    fields, pos = [], 32
    while data[pos] != 0x0D:
        name = data[pos:pos + 11].split(b'\0')[0].decode('latin-1')
        ftype = chr(data[pos + 11])
        flen = data[pos + 16]
        fields.append((name, ftype, flen))
        pos += 32
    rows = []
    for i in range(nrec):
        rec = data[hlen + i * rlen: hlen + (i + 1) * rlen]
        off, row = 1, {}
        for name, ftype, flen in fields:
            raw = rec[off:off + flen].decode('latin-1').strip()
            off += flen
            if ftype in 'NF' and raw:
                try:
                    v = float(raw)
                    raw = int(v) if v.is_integer() and '.' not in raw else v
                except ValueError:
                    pass
            row[name] = raw
        rows.append(row)
    return fields, rows


def ring_area(ring):
    return sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:])) / 2


def point_in_ring(pt, ring):
    x, y = pt
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def polygon_geometry(rings):
    # Shapefile: outer rings clockwise (negative signed area), holes counter-clockwise.
    outers, holes = [], []
    for r in rings:
        (outers if ring_area(r) < 0 else holes).append(r)
    polys = [[o[::-1]] for o in outers]  # GeoJSON (RFC 7946): outer CCW
    for h in holes:
        for p in polys:
            if point_in_ring(h[0], p[0]):
                p.append(h[::-1])  # holes CW
                break
        else:
            polys.append([h])
    if len(polys) == 1:
        return {'type': 'Polygon', 'coordinates': polys[0]}
    return {'type': 'MultiPolygon', 'coordinates': polys}


def read_shp(path):
    with open(path, 'rb') as f:
        data = f.read()
    shape_type = struct.unpack('<i', data[32:36])[0]
    geoms, pos = [], 100
    while pos < len(data):
        _, clen = struct.unpack('>ii', data[pos:pos + 8])
        body = data[pos + 8: pos + 8 + clen * 2]
        pos += 8 + clen * 2
        st = struct.unpack('<i', body[:4])[0]
        if st == 0:
            geoms.append(None)
        elif st in (1, 11, 21):
            x, y = struct.unpack('<2d', body[4:20])
            geoms.append({'type': 'Point', 'coordinates': [round(x, 6), round(y, 6)]})
        elif st in (3, 5, 13, 15, 23, 25):
            nparts, npts = struct.unpack('<ii', body[36:44])
            parts = list(struct.unpack('<%di' % nparts, body[44:44 + 4 * nparts])) + [npts]
            p0 = 44 + 4 * nparts
            pts = [tuple(round(c, 6) for c in struct.unpack('<2d', body[p0 + 16 * i: p0 + 16 * i + 16]))
                   for i in range(npts)]
            rings = [pts[parts[i]:parts[i + 1]] for i in range(nparts)]
            if st in (5, 15, 25):
                geoms.append(polygon_geometry(rings))
            elif nparts == 1:
                geoms.append({'type': 'LineString', 'coordinates': rings[0]})
            else:
                geoms.append({'type': 'MultiLineString', 'coordinates': rings})
        else:
            raise ValueError('Unsupported shape type %d' % st)
    return shape_type, geoms


if __name__ == '__main__':
    base, out = sys.argv[1], sys.argv[2]
    shape_type, geoms = read_shp(base + '.shp')
    fields, rows = read_dbf(base + '.dbf')
    fc = {'type': 'FeatureCollection',
          'features': [{'type': 'Feature', 'properties': p, 'geometry': g} for g, p in zip(geoms, rows)]}
    with open(out, 'w') as f:
        json.dump(fc, f, separators=(',', ':'))
    print('shape type', shape_type, '| features', len(geoms))
    print('fields', fields)
    for g, p in zip(geoms, rows):
        print(g['type'] if g else None, p)
