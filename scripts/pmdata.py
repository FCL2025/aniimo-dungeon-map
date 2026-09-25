"""Read-only decoder for Aniimo resource version 3595896's pooled data tables.

Format inferred from local structural invariants: six pools + 76-byte footer;
each table references a 12-byte schema (keys, value types, relative offsets).
No Lua or game code is executed.
"""
from collections.abc import Mapping
from functools import lru_cache
import struct
import zipfile

DEFAULT_ARCHIVE = r'F:\Pawprint\Aniimo\game\Aniimo_Data\cvs\res\lua\LuaScripts.xdf'
MEMBER = 'xfs/luascripts/Common/Data/pmdata.bin'
FORMATS = {0:'d',1:'B',2:'b',3:'H',4:'h',5:'I',6:'i'}


class PMData:
    def __init__(self, archive=DEFAULT_ARCHIVE):
        with zipfile.ZipFile(archive) as z:
            self.data=z.read(MEMBER)
        footer=struct.unpack_from('<19I',self.data,len(self.data)-76)
        self.pools=[footer[i:i+3] for i in range(0,18,3)]
        assert self.pools[0][0]==0
        for i,(start,end,count) in enumerate(self.pools):
            assert start<=end<len(self.data)-76
            if i:assert start==self.pools[i-1][1]+1
        assert self.pools[-1][1]+1==len(self.data)-76
        assert self.pools[4][1]-self.pools[4][0]+1==self.pools[4][2]*12
        self.root=self.table(footer[-1])

    def number(self, pos, fmt='I'):
        return struct.unpack_from('<'+fmt,self.data,pos)[0]

    @lru_cache(maxsize=100000)
    def string(self,pos):
        start,end,_=self.pools[0]
        if not start<=pos<=end:raise ValueError(f'Invalid string offset {pos}')
        return self.data[pos:self.data.index(0,pos,end+1)].decode('utf-8')

    @lru_cache(maxsize=80000)
    def schema(self,pos):
        start,end,_=self.pools[4]
        if not start<=pos<=end or (pos-start)%12:
            raise ValueError(f'Invalid table schema offset {pos}')
        kp,tp,op=struct.unpack_from('<3I',self.data,pos)
        dense,kt,total,numeric=struct.unpack_from('<IBII',self.data,kp)
        if not 0<=dense<=numeric<=total:raise ValueError('Invalid key counts')
        if kt not in FORMATS:raise ValueError(f'Unknown key type {kt}')
        fmt=FORMATS[kt];size=struct.calcsize('<'+fmt);p=kp+13
        keys=[self.number(p+i*size,fmt) for i in range(numeric)]
        p+=numeric*size
        keys.extend(self.string(self.number(p+i*4)) for i in range(total-numeric))
        ot=self.data[op]
        if ot not in FORMATS:raise ValueError(f'Unknown offset type {ot}')
        ofmt=FORMATS[ot];osize=struct.calcsize('<'+ofmt)
        offsets=[self.number(op+1+i*osize,ofmt) for i in range(total)]
        types=self.data[tp:tp+total]
        assert len(set(keys))==len(keys)
        if any(o<4 and t<100 for o,t in zip(offsets,types)):
            raise ValueError(f'Invalid value offset: schema={pos}, keys={keys}, types={list(types)}, offsets={offsets}')
        # Types >= 100 reference shared constants BACKWARDS from each offset cell.
        cells=[op+1+i*osize for i in range(total)]
        return keys,types,offsets,cells

    def table(self,pos):
        start,end,_=self.pools[5]
        if not start<=pos<=end:raise ValueError(f'Invalid table offset {pos}')
        return PMTable(self,pos)

    def value(self,pos,t):
        if t in FORMATS:return self.number(pos,FORMATS[t])
        if t==7:return self.string(self.number(pos))
        if t==8:return self.table(self.number(pos))
        if t==9:
            v=self.number(pos,'B')
            if v not in (0,1):raise ValueError(f'Invalid boolean {v}')
            return bool(v)
        raise ValueError(f'Unknown value type {t} at {pos}')


class PMTable(Mapping):
    def __init__(self,owner,pos):
        self.owner,self.pos=owner,pos
        self.keys_list,self.types,self.offsets,self.offset_cells=owner.schema(owner.number(pos))
        self.index={k:i for i,k in enumerate(self.keys_list)}

    def __iter__(self):return iter(self.keys_list)
    def __len__(self):return len(self.keys_list)
    def __getitem__(self,key):
        i=self.index[key]
        t=self.types[i]
        if t>=100:
            return self.owner.value(self.offset_cells[i]-self.offsets[i],t-100)
        return self.owner.value(self.pos+self.offsets[i],t)


def plain(value,depth=30):
    if not isinstance(value,PMTable):return value
    if depth<=0:return {'_table_offset':value.pos,'_keys':len(value)}
    return {k:plain(v,depth-1) for k,v in value.items()}


if __name__=='__main__':
    import json,sys
    pm=PMData()
    for name in sys.argv[1:]:
        print(name,json.dumps(plain(pm.root[name]),ensure_ascii=False,indent=2))
