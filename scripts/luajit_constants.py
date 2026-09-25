"""Read LuaJIT v2 constant tables without executing bytecode.

Format: https://github.com/LuaJIT/LuaJIT/blob/v2.1/src/lj_bcdump.h
"""
import struct


class Reader:
    def __init__(self,data):self.data,self.pos=data,0
    def take(self,n):
        v=self.data[self.pos:self.pos+n]
        if len(v)!=n:raise ValueError('Truncated bytecode')
        self.pos+=n;return v
    def u(self):
        value=shift=0
        while True:
            b=self.take(1)[0];value|=(b&127)<<shift
            if not b&128:return value
            shift+=7
            if shift>35:raise ValueError('Invalid ULEB128')
    def constant(self):
        t=self.u()
        if t>=5:return self.take(t-5).decode('utf8',errors='replace')
        if t==0:return None
        if t==1:return False
        if t==2:return True
        if t==3:
            v=self.u();return v if v<2**31 else v-2**32
        if t==4:return struct.unpack('<d',struct.pack('<II',self.u(),self.u()))[0]
        raise ValueError(t)


def constants(data):
    r=Reader(data)
    if r.take(4)!=b'\x1bLJ\x02':raise ValueError('Not LuaJIT v2')
    flags=r.u()
    name='' if flags&2 else r.take(r.u()).decode('utf8',errors='replace')
    prototypes=[]
    while True:
        size=r.u()
        if size==0:break
        end=r.pos+size
        pf,np,fs,nu=r.take(4)
        ng,nk,nb=r.u(),r.u(),r.u()
        if not flags&2:
            debuglen=r.u()
            if debuglen:r.u();r.u()
        bytecode=r.take(nb*4)
        upvalues=[struct.unpack('<H',r.take(2))[0] for _ in range(nu)]
        items=[]
        for _ in range(ng):
            t=r.u()
            if t>=5:items.append(r.take(t-5).decode('utf8',errors='replace'))
            elif t==0:items.append({'_child':True})
            elif t==1:
                na,nh=r.u(),r.u();table={}
                for i in range(na):table[i]=r.constant()
                for i in range(nh):
                    k=r.constant();v=r.constant();table[k]=v
                items.append(table)
            elif t in (2,3):items.append({'_int64_words':[r.u(),r.u()]})
            elif t==4:items.append({'_complex_words':[r.u() for _ in range(4)]})
            else:raise ValueError(t)
        numbers=[]
        for _ in range(nk):
            v=r.u()
            if v&1:
                numbers.append(struct.unpack('<d',struct.pack('<II',v>>1,r.u()))[0])
            else:
                v>>=1
                numbers.append(v if v<2**31 else v-2**32)
        if r.pos>end:raise ValueError('Constant pool overrun')
        prototypes.append(dict(constants=items,numbers=numbers,upvalues=upvalues,
                               params=np,frame_size=fs,bytecode=bytecode))
        r.pos=end
    return name,prototypes


if __name__=='__main__':
    import zipfile,json
    from pmdata import DEFAULT_ARCHIVE
    with zipfile.ZipFile(DEFAULT_ARCHIVE) as z:
        _,ps=constants(z.read('xfs/luascripts/Common/Const/Const.lua'))
        for p in ps:
            for c in p['constants']:
                if isinstance(c,dict) and any(k in c for k in ['NIGHTMARE','CHAOS','PveChaos']):
                    print(json.dumps(c,ensure_ascii=False))
