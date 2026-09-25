"""Compare map geometry with user-supplied references and create a local review gallery."""
from collections import defaultdict
import csv
from html import escape
import json
import math
from pathlib import Path
import re
import shutil

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageStat

from build_previews import font

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(r'C:\Users\pu960\Desktop\搶蛋地圖')
EXPORT = ROOT / 'exports/grab-eggs-dungeons'


def geometry(path):
    im=Image.open(path).convert('RGBA')
    original_size=im.size
    im.thumbnail((768,768),Image.Resampling.LANCZOS)
    gray=im.convert('L')
    mask=gray.point(lambda v: 255 if 40 < v < 230 else 0)
    mask=ImageChops.multiply(mask,im.getchannel('A'))
    # Remove isolated compression noise, then close small marker holes.
    mask=mask.filter(ImageFilter.MedianFilter(5)).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))
    bbox=mask.getbbox()
    if not bbox:
        raise ValueError(f'No geometry found in {path}')
    mask=mask.crop(bbox)
    aspect=mask.width/mask.height
    scale_x,scale_y=original_size[0]/im.width,original_size[1]/im.height
    original_bbox=(round(bbox[0]*scale_x),round(bbox[1]*scale_y),round(bbox[2]*scale_x),round(bbox[3]*scale_y))
    return mask.resize((256,256),Image.Resampling.NEAREST),aspect,original_bbox


def similarity(a,b):
    intersection=ImageStat.Stat(ImageChops.darker(a,b)).sum[0]
    union=ImageStat.Stat(ImageChops.lighter(a,b)).sum[0]
    return intersection/union if union else 0


def main():
    preview=EXPORT/'preview'
    reference_dir=EXPORT/'references'
    reference_dir.mkdir(exist_ok=True)
    comparison_dir=EXPORT/'comparison'
    comparison_dir.mkdir(exist_ok=True)
    maps={}
    for p in sorted(preview.glob('UI_Img_Map_*_cropped.png')):
        match=re.fullmatch(r'UI_Img_Map_(\d+)(_combined)?_cropped',p.stem)
        if match and int(match[1])>=20031:
            maps[(match[1],'combined' if match[2] else 'base')]=(p,*geometry(p))
    results=[]
    for ref in sorted(SOURCE.glob('*.jpg')):
        rm,aspect,bbox=geometry(ref)
        ranked=[]
        best_by_map={}
        for (map_id,variant),(path,mask,map_aspect,_) in maps.items():
            iou=similarity(rm,mask)
            ratio=min(aspect,map_aspect)/max(aspect,map_aspect)
            candidate=(iou*ratio,map_id,iou,ratio,variant)
            if map_id not in best_by_map or candidate[0]>best_by_map[map_id][0]:
                best_by_map[map_id]=candidate
        ranked=list(best_by_map.values())
        ranked.sort(reverse=True)
        score,map_id,iou,ratio,variant=ranked[0]
        gap=score-ranked[1][0]
        # Scores measure silhouette overlap, not a probability or a difficulty mapping.
        status='strong_geometry_match' if score>=0.75 and gap>=0.12 else 'needs_review'
        review_note=None
        if ref.name=='1(下).jpg' and map_id=='20034':
            status='visually_reviewed_match'
            review_note='已目視核對主走廊、房間與入口配置一致；範例下緣裁掉部分地圖，整張輪廓比對分數較低。'
        copied=reference_dir/ref.name
        shutil.copy2(ref,copied)
        record=dict(reference=ref.name,map_id=map_id,score=round(score,4),iou=round(iou,4),
                    variant=variant,
                    aspect_agreement=round(ratio,4),runner_up=ranked[1][1],margin=round(gap,4),
                    status=status,alternatives=ranked[:3],reference_bbox=bbox)
        if review_note:record['review_note']=review_note
        results.append(record)
        images=[Image.open(ref).convert('RGB'),Image.open(maps[(map_id,variant)][0]).convert('RGBA')]
        sheet=Image.new('RGB',(1600,900),'#14171a');draw=ImageDraw.Draw(sheet)
        draw.text((20,15),ref.stem,font=font(25),fill='white')
        variant_label='底圖＋分層疊圖' if variant=='combined' else '原始底圖'
        draw.text((820,15),f'{variant_label} {map_id}',font=font(25),fill='white')
        for i,im in enumerate(images):
            if i==0:im=im.crop(bbox)
            im.thumbnail((770,800),Image.Resampling.LANCZOS)
            pos=(i*800+(800-im.width)//2,60+(800-im.height)//2)
            sheet.paste(im,pos,im.getchannel('A') if im.mode=='RGBA' else None)
        draw.text((20,862),f'地形比對 {score:.3f}  |  僅比對底圖，未驗證獎勵位置或難度',font=font(17),fill='#b6bec6')
        name=ref.stem+'.jpg';sheet.save(comparison_dir/name,quality=93)
        record['comparison']='comparison/'+name
        print(ref.name,'=>',map_id,round(score,3),'gap',round(gap,3),status,flush=True)
    (EXPORT/'reference-matches.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    with (EXPORT/'reference-matches.csv').open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=['reference','map_id','score','runner_up','margin','status'],extrasaction='ignore')
        writer.writeheader();writer.writerows(results)
    by_map=defaultdict(list)
    for record in results:by_map[record['map_id']].append(record)
    cards=[]
    base_maps={map_id:value for (map_id,variant),value in maps.items() if variant=='base'}
    for map_id,(path,*_) in base_maps.items():
        links=[]
        for r in by_map[map_id]:
            label={'strong_geometry_match':'地形吻合','visually_reviewed_match':'已目視核對（範例有裁切）'}.get(r['status'],'待核對')
            links.append(f'<li><a href="{escape(r["comparison"],quote=True)}">{escape(r["reference"])} ↗</a> <small>{label} · {r["score"]:.3f}</small></li>')
        png=f'preview/UI_Img_Map_{map_id}.png'
        jpg=f'preview/UI_Img_Map_{map_id}_preview.jpg'
        layer_links=' '.join(f'<a href="{p.relative_to(EXPORT).as_posix()}">分層 {i+1} ↗</a>' for i,p in enumerate(sorted(preview.glob(f'UI_Img_Map_Layer_{map_id}_*_preview.jpg'))))
        cards.append(f'<article><a href="{png}"><img loading="lazy" src="{jpg}" alt="地宮 {map_id}"></a><h2>{map_id}</h2><p><a href="{png}">原尺寸 PNG ↗</a> · <a href="preview/UI_Img_Map_{map_id}_combined.png">底圖＋分層疊圖 ↗</a><br>{layer_links} · <a href="preview/UI_Img_Map_{map_id}_tiles.jpg">切片編號 ↗</a></p><ul>{"".join(links) or "<li>目前無對應範例</li>"}</ul></article>')
    strong=sum(r['status']=='strong_geometry_match' for r in results)
    html='''<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>搶蛋地宮地圖｜提取結果</title><style>
    body{font-family:system-ui,"Microsoft JhengHei",sans-serif;background:#11171b;color:#e8edf0;margin:0;padding:36px;line-height:1.6}main{max-width:1500px;margin:auto}h1{margin:8px 0}p{color:#b9c6ce}a{color:#9bdbbf}header{margin-bottom:30px}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px}article{background:#1b252c;border:1px solid #34424c;border-radius:10px;padding:14px}article img{width:100%;height:290px;object-fit:contain;background:#101214}h2{margin:10px 0 4px}ul{padding-left:20px;font-size:14px}small{color:#a3b4bf}nav a{display:inline-block;margin-right:20px}footer{margin-top:35px;color:#a3b4bf}
    </style><main><header><small>ANIIMO / LOCAL MAP EXTRACTION</small><h1>搶蛋地宮地圖</h1>'''
    reviewed=sum(r['status']=='visually_reviewed_match' for r in results)
    html+=f'<p>原始底圖 20031–20060 與 29999，共 31 張；每張 2048 × 2048。已比對 {len(results)} 張範例，{strong} 張符合自動地形比對門檻，另 {reviewed} 張裁切範例已目視核對。</p>'
    html+='<p>點圖片開啟完整 PNG；點範例名稱查看並排對照。底圖不含範例上的寶箱、蛋等標記。資源編號不代表惡夢／混沌難度。疊圖供比對外形，不表示所有樓層同時可通行。</p><nav><a href="preview/dungeons-overview.jpg">31 張地宮總覽 ↗</a><a href="reference-matches.csv">範例對應表 ↗</a><a href="../grab-eggs/preview/overview.jpg">3004 外部地圖與分層 ↗</a></nav></header>'
    html+='<section>'+''.join(cards)+'</section><footer>資料來源：本機遊戲版本 3595896。範例來源：使用者提供的「搶蛋地圖」資料夾。原始遊戲與範例檔案未修改。</footer></main></html>'
    (EXPORT/'index.html').write_text(html,encoding='utf-8')
    # A compact overview containing only detailed dungeon maps.
    sheet=Image.new('RGB',(1800,math.ceil(len(base_maps)/5)*330),'#15191c');draw=ImageDraw.Draw(sheet)
    for i,(map_id,(path,*_)) in enumerate(base_maps.items()):
        im=Image.open(path).convert('RGBA');im.thumbnail((344,285),Image.Resampling.LANCZOS)
        x,y=(i%5)*360,(i//5)*330
        sheet.paste(im,(x+(360-im.width)//2,y+8+(285-im.height)//2),im.getchannel('A'))
        draw.text((x+12,y+300),map_id,font=font(20),fill='white')
    sheet.save(preview/'dungeons-overview.jpg',quality=95)


if __name__=='__main__':main()
