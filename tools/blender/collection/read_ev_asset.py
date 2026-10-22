"""Read public EV skin/object containers for offline Blender remodeling.

Independent reader of the field layout exposed by the official preview tool.
Never executes source client code. Rejects truncated/unknown containers.
"""
import struct

class Reader:
    def __init__(self, data): self.data=data; self.at=0
    def read(self, fmt):
        size=struct.calcsize('<'+fmt)
        if self.at+size>len(self.data): raise ValueError('Truncated asset')
        value=struct.unpack_from('<'+fmt,self.data,self.at);self.at+=size
        return value[0] if len(value)==1 else list(value)
    def u8(self): return self.read('B')
    def u16(self): return self.read('H')
    def i16(self): return self.read('h')
    def f(self): return self.read('f')
    def array(self,fn): return [fn() for _ in range(self.u16())]
    def text(self):
        n=self.u8();s=self.data[self.at:self.at+n].decode('latin1');self.at+=n;return s
    def floats(self,n): return self.read(str(n)+'f') if n else []
    def indices(self): return self.array(self.u16)
    def texture(self):
        kind=self.u8();size=self.read('I');raw=self.data[self.at:self.at+size];self.at+=size
        return {'kind':kind,'bytes':raw}
    def material(self,typed):
        shader=self.u8() if typed else 0
        m={'shader':shader,'color':[.4,.4,.4,1]}
        if shader==0:
            flags=self.u8();more=self.u8() if flags&128 else 0
            for bit,key,fn in [(1,'color',lambda:[v/255 for v in self.read('4B')]),(2,'map',self.u16),(4,'emissive',lambda:[v/255 for v in self.read('3B')]),(8,'emissiveMap',self.u16),(16,'intensity',self.f),(32,'metallic',self.f),(64,'metallicMap',self.u16)]:
                if flags&bit:m[key]=fn()
            for bit,key,fn in [(1,'roughness',self.f),(2,'roughnessMap',self.i16),(4,'aoMap',self.i16),(8,'ao',self.f),(16,'normalMap',self.i16),(32,'uvTransform',lambda:self.floats(4))]:
                if more&bit:m[key]=fn()
        elif shader==1:
            m['color']=[v/255 for v in self.read('4B')];m['map']=self.u16()
            self.floats(4);self.floats(4);self.f();self.floats(4);self.floats(3);self.read('4B')
        elif shader==2:m['color']=[v/255 for v in self.read('3B')]+[1]
        elif shader!=3:raise ValueError('Unknown shader '+str(shader))
        return m
    def transform(self):return {'position':self.floats(3),'rotation':self.floats(4),'scale':self.floats(3)}
    def bone(self):
        name=self.text();parent=self.i16();t=self.transform()
        return dict(name=name,parent=parent,mesh=self.i16(),**t)
    def skinmesh(self):
        normals=self.floats(self.u16()*3);vertices=self.floats(self.u16()*3)
        groups=self.array(lambda:{'material':self.i16(),'indices':self.indices()})
        inverse=self.array(lambda:self.floats(16));bones=self.indices()
        weights=self.array(lambda:{'bones':self.read('4H'),'weights':self.floats(4)})
        return dict(normals=normals,vertices=vertices,groups=groups,inverse=inverse,bones=bones,weights=weights)
    def compressed(self,dim):
        if not self.u8():return []
        limits=self.floats(dim*2);n=self.u16();values=[]
        for _ in range(n):
            values.extend(limits[j]+(limits[j+dim]-limits[j])*self.u16()/65535 for j in range(dim))
        return values
    def geometry(self):
        flags=self.u8();g={'vertices':self.compressed(3),'groups':self.array(lambda:{'indices':self.indices()})}
        if flags&1:g['normals']=self.compressed(3)
        if flags&2:g['uv']=self.compressed(2)
        if flags&4:self.compressed(2)
        if flags&8:
            n=self.u16();uv=[]
            for i in range(0,n,2):
                packed=self.u8()
                for v in [packed&15,packed>>4][:min(2,n-i)]:uv.extend([.125+.25*(v&3),.125+.25*((v>>2)&3)])
            g['uv']=uv
        return g
    def node(self):
        flags=self.u8();n=self.transform();n['children']=self.array(self.node)
        n['name']=self.text() if flags&1 else '';n['geometry']=self.u16() if flags else -1
        n['materials']=self.indices() if flags&2 else []
        if flags&32:self.read('I')
        if flags&8:self.u16();self.floats(4)
        return n

def read_asset(path):
    r=Reader(path.read_bytes());version=r.u8();flags=r.u8();out={'version':version}
    if version==4:
        out['textures']=r.array(r.texture);out['materials']=r.array(lambda:r.material(bool(flags&8)))
        out['bones']=r.array(r.bone);out['meshes']=r.array(r.skinmesh)
        if flags&1:r.text();r.array(r.text)
        if flags&2:r.text();r.array(lambda:r.array(r.text))
    elif version==6:
        out['geometries']=r.array(r.geometry);out['textures']=r.array(r.texture)
        out['materials']=r.array(lambda:r.material(bool(flags&4)));out['root']=r.node()
        if flags&1:out['firstPersonOffset']=r.floats(3)
        if flags&2:out['binding']={'position':r.floats(3),'rotation':r.floats(4),'scale':r.floats(3),'bone':r.text()}
    else:raise ValueError('Unsupported container version '+str(version))
    if r.at!=len(r.data):raise ValueError(f'Unconsumed data: {r.at}/{len(r.data)}')
    return out
