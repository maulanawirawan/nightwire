"""nightwire cinematic: a rain-soaked neon avenue, rendered in Blender (EEVEE).

blender -b --factory-startup --python city.py -- <out_dir> [test|anim] [frame]

Everything is generated from code: buildings, wet asphalt, neon signs, street lamps,
parked and moving cars, rain, volumetric fog and the green "verified" beam.
"""
import math
import os
import random
import sys

import bpy
import bmesh

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else 'render')
MODE = argv[1] if len(argv) > 1 else 'test'
FRAME = int(argv[2]) if len(argv) > 2 else 1
os.makedirs(OUT, exist_ok=True)
random.seed(20261119)
R = random.random

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
FPS, FRAMES = 24, 192
scene.frame_start, scene.frame_end = 1, FRAMES
scene.render.fps = FPS


def tryset(obj, attr, value):
    try:
        setattr(obj, attr, value)
        return True
    except Exception:
        return False


# ---------------------------------------------------------------- node helpers
class NT:
    def __init__(self, tree):
        self.t = tree

    def n(self, kind, **inputs):
        node = self.t.nodes.new(kind)
        for k, v in inputs.items():
            self.set(node.inputs[k], v)
        return node

    def set(self, sock, v):
        if hasattr(v, 'is_output') or hasattr(v, 'links'):
            self.t.links.new(v, sock)
        else:
            sock.default_value = v

    def link(self, a, b):
        self.t.links.new(a, b)

    def math(self, op, a, b=None, clamp=False):
        m = self.t.nodes.new('ShaderNodeMath')
        m.operation = op
        m.use_clamp = clamp
        self.set(m.inputs[0], a)
        if b is not None:
            self.set(m.inputs[1], b)
        return m.outputs[0]

    def mixf(self, f, a, b):  # a*(1-f) + b*f
        return self.math('ADD', self.math('MULTIPLY', a, self.math('SUBTRACT', 1.0, f)), self.math('MULTIPLY', b, f))

    def mixc(self, f, a, b):
        m = self.t.nodes.new('ShaderNodeMix')
        m.data_type = 'RGBA'
        self.set(m.inputs['Factor'], f)
        self.set(m.inputs[6], a)
        self.set(m.inputs[7], b)
        return m.outputs[2]

    def rgb(self, f, stops):
        cr = self.t.nodes.new('ShaderNodeValToRGB')
        self.set(cr.inputs[0], f)
        els = cr.color_ramp.elements
        while len(els) < len(stops):
            els.new(0.5)
        for e, (pos, col) in zip(els, stops):
            e.position = pos
            e.color = (*col, 1)
        return cr.outputs[0]


def material(name):
    m = bpy.data.materials.new(name)
    tryset(m, 'use_nodes', True)
    m.node_tree.nodes.clear()
    nt = NT(m.node_tree)
    out = nt.n('ShaderNodeOutputMaterial')
    return m, nt, out


def principled(nt, out, **kw):
    p = nt.t.nodes.new('ShaderNodeBsdfPrincipled')
    for k, v in kw.items():
        nt.set(p.inputs[k], v)
    nt.link(p.outputs[0], out.inputs['Surface'])
    return p


def emission_mat(name, color, strength):
    m, nt, out = material(name)
    e = nt.n('ShaderNodeEmission', Color=(*color, 1), Strength=strength)
    nt.link(e.outputs[0], out.inputs['Surface'])
    return m


def paint_mat(name, color, metallic=0.0, rough=0.4, coat=0.0):
    m, nt, out = material(name)
    principled(nt, out, **{'Base Color': (*color, 1), 'Metallic': metallic, 'Roughness': rough, 'Coat Weight': coat})
    return m


# ---------------------------------------------------------------- materials
def facade_material():
    m, nt, out = material('facade')
    geo = nt.n('ShaderNodeNewGeometry')
    attr = nt.n('ShaderNodeAttribute')
    attr.attribute_type = 'GEOMETRY'
    attr.attribute_name = 'bseed'
    seed = attr.outputs['Fac']
    sp = nt.n('ShaderNodeSeparateXYZ', Vector=geo.outputs['Position'])
    sn = nt.n('ShaderNodeSeparateXYZ', Vector=geo.outputs['Normal'])
    is_x = nt.math('GREATER_THAN', nt.math('ABSOLUTE', sn.outputs[0]), 0.5)
    top = nt.math('GREATER_THAN', sn.outputs[2], 0.5)
    hcoord = nt.mixf(is_x, sp.outputs[0], sp.outputs[1])
    glassy = nt.math('GREATER_THAN', seed, 0.58)            # curtain-wall towers
    bay = nt.mixf(glassy, 1.6, 1.4)
    cx = nt.math('DIVIDE', hcoord, bay)
    cy = nt.math('DIVIDE', sp.outputs[2], 3.4)
    fx, fy = nt.math('FRACT', cx), nt.math('FRACT', cy)
    ix, iy = nt.math('FLOOR', cx), nt.math('FLOOR', cy)
    x0 = nt.mixf(glassy, 0.14, 0.04)
    y0 = nt.mixf(glassy, 0.22, 0.12)
    win = nt.math('MULTIPLY',
                  nt.math('MULTIPLY', nt.math('GREATER_THAN', fx, x0), nt.math('LESS_THAN', fx, nt.math('SUBTRACT', 1.0, x0))),
                  nt.math('MULTIPLY', nt.math('GREATER_THAN', fy, y0), nt.math('LESS_THAN', fy, 0.88)))
    win = nt.math('MULTIPLY', win, nt.math('SUBTRACT', 1.0, top))
    mullion = nt.math('LESS_THAN', nt.math('ABSOLUTE', nt.math('SUBTRACT', fx, 0.5)), 0.018)
    win = nt.math('MULTIPLY', win, nt.math('SUBTRACT', 1.0, mullion))
    cell = nt.n('ShaderNodeCombineXYZ', X=nt.math('ADD', ix, nt.math('MULTIPLY', seed, 977.0)), Y=iy, Z=nt.math('MULTIPLY', is_x, 13.0))
    wn1 = nt.n('ShaderNodeTexWhiteNoise', Vector=cell.outputs[0])
    wn1.noise_dimensions = '3D'
    cell2 = nt.n('ShaderNodeCombineXYZ', X=iy, Y=nt.math('ADD', ix, 31.0), Z=nt.math('MULTIPLY', seed, 311.0))
    wn2 = nt.n('ShaderNodeTexWhiteNoise', Vector=cell2.outputs[0])
    wn2.noise_dimensions = '3D'
    r1, r2 = wn1.outputs['Value'], wn2.outputs['Value']
    thr = nt.math('ADD', 0.45, nt.math('MULTIPLY', nt.math('FRACT', nt.math('MULTIPLY', seed, 7.13)), 0.38))
    lit = nt.math('MULTIPLY', nt.math('GREATER_THAN', r1, thr), win)
    lcol = nt.rgb(r2, [(0.0, (1.0, 0.52, 0.22)), (0.55, (1.0, 0.72, 0.42)), (0.8, (0.72, 0.85, 1.0)), (1.0, (0.55, 0.65, 1.0))])
    # ceiling light falls off toward the sill, blinds dim some rooms
    grad = nt.math('ADD', 0.45, nt.math('MULTIPLY', fy, 0.75))
    blind = nt.math('GREATER_THAN', nt.math('FRACT', nt.math('MULTIPLY', r2, 7.0)), 0.7)
    stripes = nt.math('GREATER_THAN', nt.math('FRACT', nt.math('MULTIPLY', fy, 22.0)), 0.45)
    dim = nt.mixf(blind, 1.0, nt.math('MULTIPLY', stripes, 0.55))
    strength = nt.math('MULTIPLY', nt.math('MULTIPLY', lit, nt.math('ADD', 0.35, nt.math('MULTIPLY', nt.math('POWER', r1, 3.0), 2.6))), nt.math('MULTIPLY', grad, dim))
    wall = nt.rgb(nt.math('FRACT', nt.math('MULTIPLY', seed, 3.7)), [(0.0, (0.05, 0.05, 0.055)), (0.35, (0.11, 0.1, 0.095)), (0.7, (0.035, 0.045, 0.06)), (1.0, (0.16, 0.15, 0.14))])
    noise = nt.n('ShaderNodeTexNoise', Vector=geo.outputs['Position'], Scale=0.6, Detail=6.0)
    streak = nt.n('ShaderNodeTexNoise', Scale=2.0, Detail=3.0)
    mapping = nt.n('ShaderNodeMapping', Vector=geo.outputs['Position'], Scale=(3.0, 3.0, 0.15))
    nt.link(mapping.outputs[0], streak.inputs['Vector'])
    grime = nt.math('MULTIPLY', nt.math('ADD', 0.55, noise.outputs['Fac']), nt.math('ADD', 0.6, nt.math('MULTIPLY', streak.outputs['Fac'], 0.6)))
    wallc = nt.n('ShaderNodeMix')
    wallc.data_type = 'RGBA'
    wallc.blend_type = 'MULTIPLY'
    nt.set(wallc.inputs['Factor'], 1.0)
    nt.set(wallc.inputs[6], wall)
    gcol = nt.n('ShaderNodeCombineColor', Red=grime, Green=grime, Blue=grime)
    nt.set(wallc.inputs[7], gcol.outputs[0])
    glass_col = (0.004, 0.006, 0.009, 1)
    base = nt.mixc(win, wallc.outputs[2], glass_col)
    roof = nt.mixc(top, base, (0.025, 0.025, 0.028, 1))
    rough = nt.mixf(win, nt.math('ADD', 0.45, nt.math('MULTIPLY', noise.outputs['Fac'], 0.3)), 0.03)
    p = principled(nt, out, **{'Base Color': roof, 'Roughness': rough, 'Specular IOR Level': nt.mixf(win, 0.4, 0.9),
                               'Emission Color': lcol, 'Emission Strength': strength})
    return m


def asphalt_material():
    m, nt, out = material('asphalt')
    geo = nt.n('ShaderNodeNewGeometry')
    sp = nt.n('ShaderNodeSeparateXYZ', Vector=geo.outputs['Position'])
    x, y = sp.outputs[0], sp.outputs[1]
    grain = nt.n('ShaderNodeTexNoise', Vector=geo.outputs['Position'], Scale=45.0, Detail=8.0)
    pud_n = nt.n('ShaderNodeTexNoise', Vector=geo.outputs['Position'], Scale=0.09, Detail=5.0, Roughness=0.6)
    puddle = nt.math('MULTIPLY', nt.math('SUBTRACT', pud_n.outputs['Fac'], 0.47), 9.0, clamp=True)
    base = nt.rgb(grain.outputs['Fac'], [(0.3, (0.012, 0.012, 0.014)), (0.7, (0.04, 0.04, 0.043))])
    ax = nt.math('ABSOLUTE', x)
    dash = nt.math('LESS_THAN', nt.math('FRACT', nt.math('DIVIDE', y, 9.0)), 0.5)
    center = nt.math('MULTIPLY', nt.math('LESS_THAN', ax, 0.09), dash)
    edge = nt.math('LESS_THAN', nt.math('ABSOLUTE', nt.math('SUBTRACT', ax, 6.4)), 0.07)
    zebra_band = nt.math('LESS_THAN', nt.math('ABSOLUTE', nt.math('SUBTRACT', y, 46.5)), 2.2)
    zebra = nt.math('MULTIPLY', nt.math('MULTIPLY', zebra_band, nt.math('LESS_THAN', nt.math('FRACT', nt.math('DIVIDE', x, 1.3)), 0.5)), nt.math('LESS_THAN', ax, 6.8))
    white = nt.math('MAXIMUM', edge, zebra)
    c1 = nt.mixc(center, base, (0.38, 0.28, 0.06, 1))
    c2 = nt.mixc(white, c1, (0.42, 0.42, 0.42, 1))
    wet = nt.mixc(puddle, c2, (0.006, 0.006, 0.007, 1))
    paint = nt.math('MAXIMUM', center, white)
    rough = nt.mixf(puddle, nt.mixf(paint, nt.math('ADD', 0.28, nt.math('MULTIPLY', grain.outputs['Fac'], 0.25)), 0.45), 0.015)
    # rain ripples in the puddles: animated 4D voronoi rings
    vor = nt.n('ShaderNodeTexVoronoi', Vector=geo.outputs['Position'], Scale=3.5)
    vor.voronoi_dimensions = '4D'
    fc = vor.inputs['W'].driver_add('default_value')
    fc.driver.expression = 'frame/9'
    ring = nt.math('SINE', nt.math('MULTIPLY', vor.outputs['Distance'], 60.0))
    ring = nt.math('MULTIPLY', ring, nt.math('SUBTRACT', 1.0, nt.math('MULTIPLY', vor.outputs['Distance'], 3.0), clamp=True))
    bump_h = nt.math('ADD', nt.math('MULTIPLY', ring, nt.math('MULTIPLY', puddle, 0.4)), nt.math('MULTIPLY', grain.outputs['Fac'], nt.math('SUBTRACT', 1.0, puddle)))
    bump = nt.n('ShaderNodeBump', Strength=0.25, Distance=0.02, Height=bump_h)
    principled(nt, out, **{'Base Color': wet, 'Roughness': rough, 'Specular IOR Level': 0.7, 'Normal': bump.outputs[0]})
    return m


def pavement_material():
    m, nt, out = material('pavement')
    geo = nt.n('ShaderNodeNewGeometry')
    brick = nt.n('ShaderNodeTexBrick', Vector=geo.outputs['Position'], Scale=1.6, **{'Mortar Size': 0.012})
    nt.set(brick.inputs['Color1'], (0.07, 0.068, 0.065, 1))
    nt.set(brick.inputs['Color2'], (0.05, 0.05, 0.05, 1))
    nt.set(brick.inputs['Mortar'], (0.015, 0.015, 0.015, 1))
    pud_n = nt.n('ShaderNodeTexNoise', Vector=geo.outputs['Position'], Scale=0.3, Detail=4.0)
    puddle = nt.math('MULTIPLY', nt.math('SUBTRACT', pud_n.outputs['Fac'], 0.5), 6.0, clamp=True)
    rough = nt.mixf(puddle, nt.math('ADD', 0.3, nt.math('MULTIPLY', brick.outputs['Fac'], 0.4)), 0.04)
    bump = nt.n('ShaderNodeBump', Strength=0.3, Distance=0.01, Height=brick.outputs['Fac'])
    principled(nt, out, **{'Base Color': brick.outputs['Color'], 'Roughness': rough, 'Normal': bump.outputs[0]})
    return m


def spire_material():
    m, nt, out = material('spire')
    geo = nt.n('ShaderNodeNewGeometry')
    sp = nt.n('ShaderNodeSeparateXYZ', Vector=geo.outputs['Position'])
    t = nt.n('ShaderNodeValue')
    fc = t.outputs[0].driver_add('default_value')
    fc.driver.expression = 'frame/24'
    band = nt.math('LESS_THAN', nt.math('FRACT', nt.math('SUBTRACT', nt.math('DIVIDE', sp.outputs[2], 28.0), nt.math('MULTIPLY', t.outputs[0], 0.25))), 0.04)
    hx = nt.math('ADD', sp.outputs[0], sp.outputs[1])
    cell = nt.n('ShaderNodeCombineXYZ', X=nt.math('FLOOR', nt.math('DIVIDE', hx, 1.6)), Y=nt.math('FLOOR', nt.math('DIVIDE', sp.outputs[2], 3.4)))
    wn = nt.n('ShaderNodeTexWhiteNoise', Vector=cell.outputs[0])
    wn.noise_dimensions = '3D'
    office = nt.math('MULTIPLY', nt.math('GREATER_THAN', wn.outputs['Value'], 0.55), 0.9)
    wcol = nt.mixc(band, (0.7, 0.85, 1.0, 1), (0.25, 1.0, 0.12, 1))
    em = nt.math('ADD', nt.math('MULTIPLY', band, 2.5), office)
    principled(nt, out, **{'Base Color': (0.01, 0.012, 0.014, 1), 'Roughness': 0.06, 'Metallic': 0.2,
                           'Emission Color': wcol, 'Emission Strength': em})
    return m


def volume_material(density):
    m, nt, out = material('haze')
    v = nt.n('ShaderNodeVolumePrincipled', Density=density, Anisotropy=0.55, Color=(0.82, 0.84, 0.9, 1))
    nt.link(v.outputs[0], out.inputs['Volume'])
    return m


M_FACADE = facade_material()
M_ASPHALT = asphalt_material()
M_PAVE = pavement_material()
M_SPIRE = spire_material()
M_DARK = paint_mat('darkmetal', (0.02, 0.02, 0.022), 0.6, 0.45)
M_GLASS = paint_mat('carglass', (0.002, 0.003, 0.004), 0.0, 0.03)
M_TIRE = paint_mat('tire', (0.01, 0.01, 0.01), 0.0, 0.7)
M_HEAD = emission_mat('headlight', (1.0, 0.94, 0.85), 60.0)
M_TAIL = emission_mat('taillight', (1.0, 0.02, 0.03), 25.0)
M_LAMP = emission_mat('lamphead', (1.0, 0.88, 0.75), 40.0)
M_RAIN = emission_mat('rain', (0.75, 0.82, 1.0), 0.55)
M_BEAM = emission_mat('beam', (0.3, 1.0, 0.15), 0.0)
NEON = [(1.0, 0.08, 0.45), (0.0, 0.85, 1.0), (1.0, 0.35, 0.02), (0.35, 1.0, 0.1), (0.6, 0.15, 1.0), (1.0, 0.85, 0.2), (1.0, 0.1, 0.1)]
M_NEON = [emission_mat(f'neon{i}', c, 28.0) for i, c in enumerate(NEON)]
M_BACK = paint_mat('signback', (0.015, 0.015, 0.018), 0.4, 0.35)


def screen_material():
    m, nt, out = material('screen')
    geo = nt.n('ShaderNodeNewGeometry')
    t = nt.n('ShaderNodeValue')
    fc = t.outputs[0].driver_add('default_value')
    fc.driver.expression = 'frame/24'
    sp = nt.n('ShaderNodeSeparateXYZ', Vector=geo.outputs['Position'])
    wave = nt.math('ADD', nt.math('MULTIPLY', sp.outputs[1], 0.35), nt.math('ADD', nt.math('MULTIPLY', sp.outputs[2], 0.2), nt.math('MULTIPLY', t.outputs[0], 0.6)))
    g = nt.rgb(nt.math('FRACT', wave), [(0.0, (0.0, 0.5, 1.0)), (0.35, (0.8, 0.05, 0.6)), (0.7, (1.0, 0.45, 0.05)), (1.0, (0.0, 0.5, 1.0))])
    px = nt.math('MULTIPLY', nt.math('LESS_THAN', nt.math('FRACT', nt.math('MULTIPLY', sp.outputs[1], 14.0)), 0.8),
                 nt.math('LESS_THAN', nt.math('FRACT', nt.math('MULTIPLY', sp.outputs[2], 14.0)), 0.8))
    principled(nt, out, **{'Base Color': (0.005, 0.005, 0.005, 1), 'Roughness': 0.15, 'Emission Color': g, 'Emission Strength': nt.math('MULTIPLY', px, 6.0)})
    return m


M_SCREEN = screen_material()
def shop_material(name, col):
    m, nt, out = material(name)
    geo = nt.n('ShaderNodeNewGeometry')
    sp = nt.n('ShaderNodeSeparateXYZ', Vector=geo.outputs['Position'])
    y, z = sp.outputs[1], sp.outputs[2]
    mull = nt.math('LESS_THAN', nt.math('FRACT', nt.math('DIVIDE', y, 2.6)), 0.03)
    kick = nt.math('LESS_THAN', z, 0.75)
    head = nt.math('GREATER_THAN', z, 3.05)
    frame = nt.math('MAXIMUM', nt.math('MAXIMUM', mull, kick), head)
    shelves = nt.math('MULTIPLY', nt.math('LESS_THAN', z, 1.6), nt.math('GREATER_THAN', nt.math('FRACT', nt.math('DIVIDE', y, 0.9)), 0.35))
    goods = nt.n('ShaderNodeTexNoise', Vector=geo.outputs['Position'], Scale=16.0, Detail=2.0)
    depth = nt.math('ADD', 0.45, nt.math('MULTIPLY', goods.outputs['Fac'], 0.6))
    tint = nt.rgb(goods.outputs['Fac'], [(0.3, (1.0, 0.85, 0.75)), (0.7, (0.9, 0.95, 1.0))])
    ceil = nt.math('ADD', 0.25, nt.math('MULTIPLY', nt.math('SUBTRACT', z, 0.75), 0.4))
    inner = nt.math('MULTIPLY', nt.math('MULTIPLY', depth, ceil), nt.math('SUBTRACT', 1.0, nt.math('MULTIPLY', shelves, 0.75)))
    em = nt.math('MULTIPLY', nt.math('MULTIPLY', inner, nt.math('SUBTRACT', 1.0, frame)), 0.9)
    ecol = nt.n('ShaderNodeMix')
    ecol.data_type = 'RGBA'
    ecol.blend_type = 'MULTIPLY'
    nt.set(ecol.inputs['Factor'], 1.0)
    nt.set(ecol.inputs[6], (*col, 1))
    nt.set(ecol.inputs[7], tint)
    principled(nt, out, **{'Base Color': (0.01, 0.01, 0.012, 1), 'Roughness': nt.mixf(frame, 0.04, 0.4), 'Metallic': nt.mixf(frame, 0.0, 0.7),
                           'Emission Color': ecol.outputs[2], 'Emission Strength': em})
    return m


M_SHOP = [shop_material('shop_warm', (1.0, 0.6, 0.3)), shop_material('shop_cool', (0.75, 0.88, 1.0))]


def shutter_material():
    m, nt, out = material('shutter')
    geo = nt.n('ShaderNodeNewGeometry')
    sp = nt.n('ShaderNodeSeparateXYZ', Vector=geo.outputs['Position'])
    rib = nt.math('SINE', nt.math('MULTIPLY', sp.outputs[2], 60.0))
    bump = nt.n('ShaderNodeBump', Strength=0.4, Distance=0.01, Height=rib)
    principled(nt, out, **{'Base Color': (0.09, 0.09, 0.09, 1), 'Metallic': 0.8, 'Roughness': 0.38, 'Normal': bump.outputs[0]})
    return m


M_SHUTTER = shutter_material()
CAR_PAINTS = [paint_mat(f'paint{i}', c, 0.85, 0.22, 1.0) for i, c in enumerate(
    [(0.01, 0.01, 0.012), (0.55, 0.56, 0.58), (0.35, 0.01, 0.015), (0.7, 0.5, 0.02), (0.02, 0.04, 0.1), (0.15, 0.15, 0.16)])]


# ---------------------------------------------------------------- geometry helpers
def link_obj(name, mesh):
    o = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(o)
    return o


def box_mesh(name, boxes, seeds=None, bottom=False):
    """boxes: (cx, cy, z0, sx, sy, sz). One mesh, per-face 'bseed' attribute."""
    bm = bmesh.new()
    lay = bm.faces.layers.float.new('bseed')
    for k, (cx, cy, z0, sx, sy, sz) in enumerate(boxes):
        x0, x1, y0, y1, z1 = cx - sx / 2, cx + sx / 2, cy - sy / 2, cy + sy / 2, z0 + sz
        v = [bm.verts.new(p) for p in [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]]
        faces = [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)]
        if bottom:
            faces.append((3, 2, 1, 0))
        s = seeds[k] if seeds else R()
        for f in faces:
            face = bm.faces.new([v[i] for i in f])
            face[lay] = s
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def cube(name, loc, size, mat, bevel=0.0, rot=0.0):
    me = box_mesh(name, [(0, 0, -size[2] / 2, size[0], size[1], size[2])], bottom=True)
    o = link_obj(name, me)
    o.location = loc
    o.rotation_euler[2] = rot
    o.data.materials.append(mat)
    if bevel:
        mod = o.modifiers.new('bevel', 'BEVEL')
        mod.width, mod.segments = bevel, 3
        tryset(mod, 'limit_method', 'NONE')
    return o


# ---------------------------------------------------------------- the city
ROAD, WALK = 7.0, 4.0
boxes, seeds = [], []
building_tops = []


def building(cx, cy, sx, sy, h):
    s = R()
    boxes.append((cx, cy, 0.0, sx, sy, h))
    seeds.append(s)
    top = h
    if h > 45 and R() < 0.6:  # setback tier
        h2 = h * (0.25 + R() * 0.35)
        boxes.append((cx, cy, h, sx * 0.72, sy * 0.72, h2))
        seeds.append(s)
        top = h + h2
    if h > 10:  # rooftop plant
        boxes.append((cx + (R() - 0.5) * sx * 0.3, cy + (R() - 0.5) * sy * 0.3, top, sx * 0.35, sy * 0.3, 1.5 + R() * 2.5))
        seeds.append(0.02)
    building_tops.append((cx, cy, top, sx, sy))
    return top


def street_side(side):
    """buildings lining the avenue on one side (side = -1 left, +1 right)"""
    y = -140.0
    fronts = []
    while y < 420:
        if 40 < y < 53:  # cross street
            y = 53
            continue
        w = 9 + R() * 14
        depth = 16 + R() * 14
        d = abs(y - 200) / 260
        h = 10 + (R() ** 1.6) * 70 * (1.2 - min(d, 1.0) * 0.5) + (25 if R() < 0.15 else 0)
        x = side * (ROAD + WALK + 0.5 + depth / 2)
        building(x, y + w / 2, depth, w, h)
        fronts.append((y, y + w, h))
        y += w + (0.6 + R() * 2.2 if R() < 0.4 else 0.2)
    return fronts


FRONTS = {-1: street_side(-1), 1: street_side(1)}
# distant skyline blocks behind the avenue
for _ in range(420):
    x = (R() - 0.5) * 900
    y = -150 + R() * 900
    if abs(x) < 45:
        continue
    d = math.hypot(x * 0.6, y - 300) / 400
    h = 15 + (R() ** 1.8) * 150 * max(0.25, 1.1 - d)
    building(x, y, 14 + R() * 26, 14 + R() * 26, h)
facade = link_obj('city', box_mesh('city', boxes, seeds))
facade.data.materials.append(M_FACADE)

# the core spire at the end of the avenue
spire = cube('spire', (0, 380, 140), (34, 34, 280), M_SPIRE)
cube('spire_mast', (0, 380, 300), (1.2, 1.2, 40), M_DARK)

# ground, sidewalks, curbs
ground = cube('ground', (0, 150, -0.05), (1600, 1600, 0.1), M_ASPHALT)
for side in (-1, 1):
    for (a, b) in [(-140, 40), (53, 420)]:
        cube(f'walk{side}{a}', (side * (ROAD + WALK / 2), (a + b) / 2, 0.075), (WALK, b - a, 0.15), M_PAVE)
        cube(f'curb{side}{a}', (side * (ROAD + 0.08), (a + b) / 2, 0.08), (0.16, b - a, 0.16), M_PAVE)


# storefronts and neon signs along the street-facing facades
WORDS = ['HOTEL', 'KOPI', 'RAMEN', 'BAR', '24H', 'SECAI', 'WARUNG', 'APOTEK', 'KARAOKE', 'NETJAGA', 'PROOF', 'OPEN', 'NOODLE',
         'LAUNDRY', 'CYBER', 'PHO', 'SUSHI', 'MOTEL', 'GAME', 'DIMSUM', 'NASI', 'CLUB', 'TATTOO', 'L3', 'VERIFIED']


def text_obj(word, loc, rot, size, mat, vertical=False, extrude=0.03):
    cu = bpy.data.curves.new('t', 'FONT')
    cu.body = '\n'.join(word) if vertical else word
    cu.size = size
    cu.extrude = extrude
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    if vertical:
        cu.space_line = 0.85
    o = bpy.data.objects.new('sign_' + word, cu)
    scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = rot
    o.data.materials.append(mat)
    return o


signs_lights = []
for side, fronts in FRONTS.items():
    face_x = side * (ROAD + WALK + 0.5)
    for (y0, y1, h) in fronts:
        mid = (y0 + y1) / 2
        # lit shop window at street level
        if R() < 0.62:
            shop = cube('shop', (face_x - side * 0.02, mid, 1.75), (0.05, (y1 - y0) * 0.86, 3.5), M_SHOP[R() < 0.3])
        else:
            cube('shutter', (face_x - side * 0.03, mid, 1.6), (0.05, (y1 - y0) * 0.86, 3.2), M_SHUTTER)
        # blade sign perpendicular to the facade with vertical lettering
        if R() < 0.78 and h > 9:
            word = random.choice(WORDS)
            col = random.randrange(len(NEON))
            hgt = 0.62 * len(word) + 0.8
            z = 4.2 + R() * min(9.0, max(0.0, h - hgt - 5))
            y = y0 + 1.0 + R() * max(0.1, (y1 - y0) - 2.0)
            cx = face_x - side * 0.9
            cube('blade', (cx, y, z + hgt / 2), (1.3, 0.14, hgt), M_BACK)
            for s in (-1, 1):
                text_obj(word, (cx, y + s * 0.09, z + hgt / 2), (math.pi / 2, 0, 0 if s < 0 else math.pi), 0.62, M_NEON[col], vertical=True)
            signs_lights.append(((cx, y, z + hgt / 2), NEON[col]))
        # horizontal sign over the shop
        elif R() < 0.5:
            word = random.choice(WORDS)
            col = random.randrange(len(NEON))
            text_obj(word, (face_x - side * 0.08, mid, 4.0), (math.pi / 2, 0, -side * math.pi / 2), 0.9, M_NEON[col])
            signs_lights.append(((face_x - side * 0.6, mid, 4.0), NEON[col]))

# street clutter that sells the realism: AC units, sagging cables, LED screens
M_AC = paint_mat('ac', (0.32, 0.32, 0.3), 0.2, 0.55)
for side, fronts in FRONTS.items():
    face_x = side * (ROAD + WALK + 0.5)
    for (y0, y1, h) in fronts:
        if y0 > 260:
            continue
        for _ in range(int((y1 - y0) * min(h, 40) / 55)):
            z = 5.0 + R() * (min(h, 40) - 6)
            yy = y0 + 0.8 + R() * max(0.1, y1 - y0 - 1.6)
            cube('ac', (face_x - side * 0.3, yy, z), (0.6, 0.85, 0.55), M_AC, bevel=0.03)
        if R() < 0.12 and h > 22:
            scr = cube('screen', (face_x - side * 0.15, (y0 + y1) / 2, 14 + R() * 6), (0.2, min(9.0, (y1 - y0) * 0.8), 6.0), M_SCREEN)
M_CABLE = paint_mat('cable', (0.01, 0.01, 0.01), 0.0, 0.5)
for k in range(26):
    y = -110 + k * 12 + R() * 6
    za, zb = 6.5 + R() * 4, 6.5 + R() * 4
    for j in range(1 + (R() < 0.6)):
        cu = bpy.data.curves.new('cable', 'CURVE')
        cu.dimensions = '3D'
        cu.bevel_depth = 0.012
        sp_ = cu.splines.new('POLY')
        pts = 12
        sp_.points.add(pts - 1)
        y2 = y + (R() - 0.5) * 6
        for i in range(pts):
            t = i / (pts - 1)
            x = -11.6 + 23.2 * t
            z = za + (zb - za) * t - 1.6 * math.sin(math.pi * t) - j * 0.35
            sp_.points[i].co = (x, y + (y2 - y) * t, z, 1)
        co = bpy.data.objects.new('cable', cu)
        co.data.materials.append(M_CABLE)
        scene.collection.objects.link(co)

# coloured spill from the signs onto the wet street
for (loc, col) in signs_lights:
    if -150 < loc[1] < 200:
        ld = bpy.data.lights.new('spill', 'POINT')
        ld.color = col
        ld.energy = 140
        ld.shadow_soft_size = 0.4
        tryset(ld, 'use_shadow', False)
        tryset(ld, 'volume_factor', 0.6)
        lo = bpy.data.objects.new('spill', ld)
        scene.collection.objects.link(lo)
        lo.location = loc

# street lamps with volumetric cones
for side in (-1, 1):
    for y in range(-130, 260, 26):
        if 38 < y < 56:
            continue
        x = side * (ROAD + 0.6)
        cube('pole', (x, y, 3.8), (0.14, 0.14, 7.6), M_DARK)
        cube('arm', (x - side * 1.0, y, 7.55), (2.0, 0.12, 0.1), M_DARK)
        cube('lamp', (x - side * 1.9, y, 7.45), (0.7, 0.32, 0.12), M_LAMP)
        if y < 200:
            ld = bpy.data.lights.new('lamp', 'SPOT')
            ld.color = (1.0, 0.86, 0.72) if R() < 0.7 else (1.0, 0.62, 0.32)
            ld.energy = 2200
            ld.spot_size = math.radians(115)
            ld.spot_blend = 0.6
            ld.shadow_soft_size = 0.25
            tryset(ld, 'volume_factor', 2.2)
            lo = bpy.data.objects.new('lamp', ld)
            scene.collection.objects.link(lo)
            lo.location = (x - side * 1.9, y, 7.3)


# cars
def car_mesh():
    bm = bmesh.new()
    def tbox(x0, x1, y0, y1, z0, z1, tx=1.0, ty0=0.0, ty1=0.0):
        v = [bm.verts.new(p) for p in [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
                                        (x0 * tx, y0 + ty0, z1), (x1 * tx, y0 + ty0, z1), (x1 * tx, y1 - ty1, z1), (x0 * tx, y1 - ty1, z1)]]
        for f in [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7), (3, 2, 1, 0)]:
            bm.faces.new([v[i] for i in f])
    tbox(-0.93, 0.93, -2.3, 2.3, 0.0, 0.62, 0.97, 0.08, 0.25)        # body, hood slopes down at the nose
    me = bpy.data.meshes.new('carbody')
    bm.to_mesh(me); bm.free()
    bm = bmesh.new()
    v = [bm.verts.new(p) for p in [(-0.86, -1.55, 0.6), (0.86, -1.55, 0.6), (0.86, 1.0, 0.6), (-0.86, 1.0, 0.6),
                                   (-0.72, -1.2, 1.12), (0.72, -1.2, 1.12), (0.72, 0.25, 1.12), (-0.72, 0.25, 1.12)]]
    for f in [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)]:
        bm.faces.new([v[i] for i in f])
    cab = bpy.data.meshes.new('carcab')
    bm.to_mesh(cab); bm.free()
    return me, cab


CAR_BODY, CAR_CAB = car_mesh()


def car(name, loc, heading, paint, lights_on=True):
    body = link_obj(name, CAR_BODY.copy())
    body.data.materials.append(paint)
    body.location = (loc[0], loc[1], 0.28)
    body.rotation_euler[2] = heading
    mod = body.modifiers.new('bevel', 'BEVEL'); mod.width, mod.segments = 0.09, 3
    cab = link_obj(name + 'cab', CAR_CAB.copy())
    cab.data.materials.append(M_GLASS)
    mod = cab.modifiers.new('bevel', 'BEVEL'); mod.width, mod.segments = 0.07, 2
    parts = [cab,
             cube(name + 'hl', (0, 2.28, 0.42), (1.45, 0.05, 0.13), M_HEAD if lights_on else M_DARK),
             cube(name + 'tl', (0, -2.31, 0.48), (1.6, 0.04, 0.09), M_TAIL)]
    for wx in (-0.84, 0.84):
        for wy in (-1.45, 1.42):
            parts.append(cube(name + 'w', (wx, wy, 0.06), (0.24, 0.68, 0.68), M_TIRE, bevel=0.1))
    for p in parts:
        p.parent = body
    return body


cars_moving = []
for side in (-1, 1):
    y = -120 + R() * 6
    while y < 240:
        if 36 < y < 58:
            y = 58
        if R() < 0.7:
            car('parked', (side * 5.9, y, 0.58), 0 if side > 0 else math.pi, random.choice(CAR_PAINTS), lights_on=False)
        y += 6.0 + R() * 4
# traffic: oncoming cars with headlights, one car ahead with tail lights
for k in range(5):
    c = car(f'oncoming{k}', (-2.6, 0, 0.58), math.pi, random.choice(CAR_PAINTS))
    start = 40 + k * 55
    c.location = (-2.6, start, 0.28)
    c.keyframe_insert('location', frame=1)
    c.location = (-2.6, start - 13.0 * FRAMES / FPS, 0.28)
    c.keyframe_insert('location', frame=FRAMES)
    ld = bpy.data.lights.new('headbeam', 'SPOT')
    ld.color = (1.0, 0.95, 0.88)
    ld.energy = 3500
    ld.spot_size = math.radians(45)
    ld.spot_blend = 0.5
    tryset(ld, 'volume_factor', 1.2)
    lo = bpy.data.objects.new('headbeam', ld)
    scene.collection.objects.link(lo)
    lo.parent = c
    lo.location = (0, 2.3, 0.42)
    lo.rotation_euler = (math.radians(-84), 0, 0)
    cars_moving.append(c)
lead = car('lead', (2.6, -40, 0.58), 0, CAR_PAINTS[2])
lead.keyframe_insert('location', frame=1)
lead.location = (2.6, -40 + 9.5 * FRAMES / FPS, 0.28)
lead.keyframe_insert('location', frame=FRAMES)
for o in bpy.data.objects:
    if o.animation_data and o.animation_data.action:
        for fc in getattr(o.animation_data.action, 'fcurves', []):
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'

# rain
rain_drop = cube('raindrop', (0, 0, -50), (0.007, 0.007, 0.42), M_RAIN)
emitter = cube('rain_emitter', (0, 0, 26), (26, 120, 0.01), M_DARK)
ps_show_emitter = True
ps_mod = emitter.modifiers.new('rain', 'PARTICLE_SYSTEM')
ps = ps_mod.particle_system.settings
ps.count = 45000
ps.frame_start, ps.frame_end = -60, FRAMES + 10
ps.lifetime = 60
ps.emit_from = 'FACE'
ps.normal_factor = 0.0
ps.object_align_factor = (0.6, 0.0, -15.0)
ps.effector_weights.gravity = 0.0
ps.render_type = 'OBJECT'
ps.instance_object = rain_drop
ps.particle_size = 1.0
ps.size_random = 0.5
ps.use_rotations = False
tryset(ps, 'use_render_emitter', False)
emitter.location = (0, 30, 26)

# haze: thicker volume over the avenue, thin everywhere else
haze = cube('haze', (0, 120, 22), (80, 560, 44), volume_material(0.013))
world = bpy.data.worlds.new('night')
scene.world = world
tryset(world, 'use_nodes', True)
wn = NT(world.node_tree)
world.node_tree.nodes.clear()
wout = wn.n('ShaderNodeOutputWorld')
tc = wn.n('ShaderNodeTexCoord')
sep = wn.n('ShaderNodeSeparateXYZ', Vector=tc.outputs['Generated'])
sky = wn.rgb(sep.outputs[2], [(0.0, (0.14, 0.055, 0.06)), (0.18, (0.04, 0.02, 0.035)), (0.6, (0.004, 0.004, 0.009))])
bg = wn.n('ShaderNodeBackground', Color=sky, Strength=1.0)
wn.link(bg.outputs[0], wout.inputs['Surface'])
wv = wn.n('ShaderNodeVolumePrincipled', Density=0.0016, Anisotropy=0.4, Color=(0.85, 0.82, 0.9, 1))
wn.link(wv.outputs[0], wout.inputs['Volume'])

# camera: driving down the avenue behind the lead car, slight handheld drift
cam_d = bpy.data.cameras.new('cam')
cam_d.lens = 28
cam_d.sensor_width = 36
cam_d.dof.use_dof = True
cam_d.dof.aperture_fstop = 2.2
cam_d.clip_end = 3000
cam = bpy.data.objects.new('cam', cam_d)
scene.collection.objects.link(cam)
scene.camera = cam
focus = bpy.data.objects.new('focus', None)
scene.collection.objects.link(focus)
cam_d.dof.focus_object = focus
for f, y, z, pitch, fy in [(1, -70, 2.1, 86.5, -48), (FRAMES, -70 + 10.5 * FRAMES / FPS, 2.6, 88.5, 25)]:
    cam.location = (0.9, y, z)
    cam.rotation_euler = (math.radians(pitch), 0, math.radians(0.6))
    cam.keyframe_insert('location', frame=f)
    cam.keyframe_insert('rotation_euler', frame=f)
    focus.location = (2.6, fy, 1.0)
    focus.keyframe_insert('location', frame=f)
for o in (cam, focus):
    for fc in getattr(o.animation_data.action, 'fcurves', []):
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
        if o is cam and fc.data_path == 'rotation_euler':
            nm = fc.modifiers.new('NOISE')
            nm.scale, nm.strength = 40, 0.006

# the "verified" moment: a green laser line sweeps up a facade on the right, then its edges lock green
SCAN0, SCAN1 = 92, 124
face_r = ROAD + WALK + 0.5
vb = next(f for f in FRONTS[1] if f[0] > 8 and f[2] > 22 and not (36 < f[0] < 58))
vy0, vy1, vh = vb
vmid, vlen, vtop = (vy0 + vy1) / 2, vy1 - vy0, min(vb[2], 48.0)
scan = cube('scanline', (face_r - 0.15, vmid, 0.3), (0.06, vlen * 0.98, 0.22), M_BEAM)
sl = bpy.data.lights.new('scanlight', 'POINT')
sl.color = (0.3, 1.0, 0.15)
sl.shadow_soft_size = 2.0
tryset(sl, 'use_shadow', False)
slo = bpy.data.objects.new('scanlight', sl)
scene.collection.objects.link(slo)
slo.parent = scan
slo.location = (-1.5, 0, 0)
for f, z in [(SCAN0, 0.3), (SCAN1, vtop)]:
    scan.location = (face_r - 0.15, vmid, z)
    scan.keyframe_insert('location', frame=f)
for f, e in [(1, 0), (SCAN0 - 1, 0), (SCAN0 + 2, 2200), (SCAN1, 2200), (SCAN1 + 6, 0)]:
    sl.energy = e
    sl.keyframe_insert('energy', frame=f)
em = M_BEAM.node_tree.nodes['Emission'].inputs['Strength']
for f, v in [(1, 0), (SCAN0 - 1, 0), (SCAN0 + 2, 60), (SCAN1, 60), (SCAN1 + 6, 0)]:
    em.default_value = v
    em.keyframe_insert('default_value', frame=f)
M_LOCK = emission_mat('lock', (0.25, 1.0, 0.12), 0.0)
for (y, sx, sy, sz, z) in [(vy0 + 0.1, 0.14, 0.14, vtop, vtop / 2), (vy1 - 0.1, 0.14, 0.14, vtop, vtop / 2), (vmid, 0.14, vlen, 0.14, vtop)]:
    cube('lock', (face_r - 0.1, y, z), (sx, sy, sz), M_LOCK)
lk = M_LOCK.node_tree.nodes['Emission'].inputs['Strength']
for f, v in [(1, 0), (SCAN1 - 2, 0), (SCAN1 + 3, 45), (FRAMES, 30)]:
    lk.default_value = v
    lk.keyframe_insert('default_value', frame=f)
print('VERIFIED BUILDING', vb)
VERIFIED = (face_r, vmid, vtop)
VERIFIED_Y0 = vy0

# ---------------------------------------------------------------- render settings
for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
    if tryset(scene.render, 'engine', eng):
        break
ee = scene.eevee
for k, v in [('taa_render_samples', 48 if MODE == 'anim' else 32), ('use_raytracing', True), ('ray_tracing_method', 'SCREEN'),
             ('use_shadows', True), ('shadow_ray_count', 2), ('shadow_step_count', 6), ('volumetric_tile_size', '4'),
             ('volumetric_samples', 96), ('use_volumetric_shadows', True), ('volumetric_end', 600.0), ('volumetric_start', 0.5),
             ('fast_gi_method', 'GLOBAL_ILLUMINATION'), ('use_fast_gi', True), ('horizon_quality', 0.5)]:
    tryset(ee, k, v)
try:
    ee.ray_tracing_options.resolution_scale = '1'
    ee.ray_tracing_options.screen_trace_quality = 0.6
except Exception:
    pass
tryset(scene.render, 'use_motion_blur', True)
tryset(scene.render, 'motion_blur_shutter', 0.5)
tryset(ee, 'use_motion_blur', True)
scene.render.resolution_x, scene.render.resolution_y = (1280, 544)
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'AgX'
# compositor: bloom, a touch of contrast and lens dispersion
comp = bpy.data.node_groups.new('comp', 'CompositorNodeTree')
comp.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
c_rl = comp.nodes.new('CompositorNodeRLayers')
c_gl = comp.nodes.new('CompositorNodeGlare')
for v in ('Bloom', 'BLOOM'):
    try:
        c_gl.inputs['Type'].default_value = v
        break
    except Exception:
        pass
for k, v in [('Threshold', 0.9), ('Strength', 0.55), ('Size', 0.6), ('Quality', 'High'), ('Saturation', 1.15)]:
    try:
        c_gl.inputs[k].default_value = v
    except Exception:
        pass
c_bc = comp.nodes.new('CompositorNodeBrightContrast')
try:
    c_bc.inputs['Contrast'].default_value = 5.0
    c_bc.inputs['Bright'].default_value = 0.0
except Exception:
    pass
c_ld = comp.nodes.new('CompositorNodeLensdist')
for k, v in [('Dispersion', 0.015), ('Distortion', -0.012)]:
    try:
        c_ld.inputs[k].default_value = v
    except Exception:
        pass
c_out = comp.nodes.new('NodeGroupOutput')
comp.links.new(c_rl.outputs['Image'], c_gl.inputs['Image'])
comp.links.new(c_gl.outputs[0], c_bc.inputs[0])
comp.links.new(c_bc.outputs[0], c_ld.inputs[0])
comp.links.new(c_ld.outputs[0], c_out.inputs[0])
scene.compositing_node_group = comp
tryset(scene.render, 'use_compositing', True)
for look in ('AgX - Punchy', 'Punchy', 'AgX - Medium High Contrast'):
    if tryset(scene.view_settings, 'look', look):
        break
scene.view_settings.exposure = 0.35
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = False

print('BUILT', len(boxes), 'boxes', len(signs_lights), 'signs', 'verified', VERIFIED)
if MODE == 'test':
    scene.frame_set(FRAME)
    scene.render.filepath = os.path.join(OUT, f'test_{FRAME:04d}.png')
    bpy.ops.render.render(write_still=True)
elif MODE == 'track':
    pass
elif MODE == 'save':
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'nightwire_city.blend'))
if MODE in ('anim', 'track'):
    import json
    from bpy_extras.object_utils import world_to_camera_view
    from mathutils import Vector
    track = {}
    anchor_pt = Vector((VERIFIED[0] - 0.3, VERIFIED_Y0 + 1.5, 6.0))
    for f in range(1, FRAMES + 1):
        scene.frame_set(f)
        v = world_to_camera_view(scene, cam, anchor_pt)
        track[f] = [round(v.x, 4), round(v.y, 4), round(v.z, 2)]
    json.dump({'scan': [SCAN0, SCAN1], 'track': track}, open(os.path.join(OUT, 'label.json'), 'w'))
    scene.frame_set(1)
if MODE == 'anim':
    scene.render.filepath = os.path.join(OUT, 'f_')
    bpy.ops.render.render(animation=True)
