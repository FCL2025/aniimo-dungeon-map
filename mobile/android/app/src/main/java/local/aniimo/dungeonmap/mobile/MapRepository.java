package local.aniimo.dungeonmap.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.Looper;
import android.util.LruCache;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

final class MapRepository {
    static final String[] DIRECTIONS = {"右","右下","下","左下","左","左上","上","右上"};
    static final String[] ARROWS = {"→","↘","↓","↙","←","↖","↑","↗"};
    static final class Pin {
        final String category, icon; final float x,y; final boolean nightmare,chaos,supplement; final int floor;
        Pin(JSONObject p, JSONObject icons) throws Exception {
            category=p.getString("category"); icon=icons.getJSONObject(p.getString("iconKey")).getString("image");
            JSONArray xy=p.getJSONArray("pixel"); x=(float)xy.getDouble(0);y=(float)xy.getDouble(1);
            JSONArray ds=p.getJSONArray("difficultyCandidates");boolean n=false,c=false;
            for(int i=0;i<ds.length();i++){n|=ds.getInt(i)==5;c|=ds.getInt(i)==6;}nightmare=n;chaos=c;
            supplement="template_supplement".equals(p.optString("provenance"));floor=p.optInt("floor",1);
        }
    }
    static final class Dungeon {
        final int id,width,height,direction; final float[] bounds; final String image; final List<Pin> pins;
        Dungeon(JSONObject m,JSONObject icons) throws Exception {
            id=m.getInt("id");image=m.getString("image");width=m.getJSONArray("size").getInt(0);height=m.getJSONArray("size").getInt(1);
            bounds=new float[4];for(int i=0;i<4;i++)bounds[i]=(float)m.getJSONArray("bounds").getDouble(i);
            JSONObject g=m.getJSONObject("portalGeometry");JSONArray a=g.getJSONArray("entrance"),b=g.getJSONArray("exit");
            direction=((int)Math.floor(Math.atan2(b.getDouble(1)-a.getDouble(1),b.getDouble(0)-a.getDouble(0))/(Math.PI/4)+.5)+8)%8;
            ArrayList<Pin> ps=new ArrayList<>();JSONArray p=m.getJSONArray("pins");for(int i=0;i<p.length();i++)ps.add(new Pin(p.getJSONObject(i),icons));
            ps.sort((p1,p2)->Boolean.compare(p2.category.startsWith("chest_"),p1.category.startsWith("chest_")));pins=Collections.unmodifiableList(ps);
        }
        String label(){return "地宮 "+id+" · "+ARROWS[direction]+" "+DIRECTIONS[direction];}
    }
    private static MapRepository instance;
    final List<Dungeon> maps;
    final Map<String,Bitmap> icons = new HashMap<>();
    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService loader = Executors.newSingleThreadExecutor();
    private final LruCache<String,Bitmap> cache = new LruCache<>(32*1024*1024){
        @Override protected int sizeOf(String key,Bitmap b){return b.getByteCount();}
    };
    static synchronized MapRepository get(Context c) {
        if(instance==null)instance=new MapRepository(c.getApplicationContext());return instance;
    }
    static SharedPreferences prefs(Context c){return c.getSharedPreferences("mobile-map-v1",Context.MODE_PRIVATE);}
    private MapRepository(Context c) {
        context=c;
        try {
            String json;try(InputStream in=c.getAssets().open("generated/maps.json");java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream()){
                byte[] buffer=new byte[8192];int count;while((count=in.read(buffer))!=-1)out.write(buffer,0,count);json=out.toString("UTF-8");
            }
            JSONObject root=new JSONObject(json),assets=root.getJSONObject("icons").getJSONObject("assets");
            ArrayList<Dungeon> result=new ArrayList<>();JSONArray rows=root.getJSONArray("maps");
            for(int i=0;i<rows.length();i++)result.add(new Dungeon(rows.getJSONObject(i),assets));maps=Collections.unmodifiableList(result);
            for(Dungeon map:maps)for(Pin p:map.pins)if(!icons.containsKey(p.icon))icons.put(p.icon,decode(p.icon,1));
        }catch(Exception error){throw new IllegalStateException("離線地圖資料無法載入",error);}
    }
    Dungeon selected(){int id=prefs(context).getInt("map",20034);for(Dungeon m:maps)if(m.id==id)return m;return maps.get(0);}
    private Bitmap decode(String image,int sample) throws Exception {
        BitmapFactory.Options options=new BitmapFactory.Options();options.inScaled=false;options.inSampleSize=sample;
        try(InputStream in=context.getAssets().open("generated/"+image)){Bitmap b=BitmapFactory.decodeStream(in,null,options);if(b==null)throw new IllegalStateException(image);return b;}
    }
    void bitmap(Dungeon map,boolean thumbnail,Consumer<Bitmap> result) {
        String key=map.image+(thumbnail?":thumb":":full");Bitmap existing=cache.get(key);
        if(existing!=null){result.accept(existing);return;}
        loader.execute(()->{
            Bitmap b=cache.get(key);
            if(b==null)try{b=decode(map.image,thumbnail?4:1);cache.put(key,b);}catch(Exception ignored){b=null;}
            Bitmap value=b;main.post(()->result.accept(value));
        });
    }
}
