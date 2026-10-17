package local.aniimo.dungeonmap.mobile;

import android.content.Context;
import android.graphics.Color;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

final class MapPanel extends LinearLayout {
    private final TextView title,footer;
    private final Button choose,collapse;
    private final FrameLayout content;
    private final DungeonView map;
    private boolean picking=false;
    MapPanel(Context c,Runnable close){
        super(c);setOrientation(VERTICAL);setClipToOutline(true);
        LinearLayout bar=Ui.row(c);bar.setPadding(Ui.dp(c,10),0,Ui.dp(c,2),0);
        title=Ui.text(c,"",12,Ui.TEXT);Ui.heading(title);bar.addView(title,new LayoutParams(0,-1,1));
        choose=tool(c,"重選","重新選擇地圖");choose.setTextSize(12);choose.setOnClickListener(v->{if(picking)showMap();else showPicker();});bar.addView(choose);
        Button fit=tool(c,"⊞","顯示整張地圖");fit.setOnClickListener(v->mapFit());bar.addView(fit);
        collapse=tool(c,"↙","收合小地圖");collapse.setOnClickListener(v->close.run());bar.addView(collapse);addView(bar,new LayoutParams(-1,Ui.dp(c,48)));
        content=new FrameLayout(c);addView(content,new LayoutParams(-1,0,1));map=new DungeonView(c);map.onTap(close);content.addView(map,new FrameLayout.LayoutParams(-1,-1));
        footer=Ui.text(c,"單點收合 · 拖曳平移 · 雙指縮放",10,Ui.MUTED);footer.setGravity(android.view.Gravity.CENTER);addView(footer,new LayoutParams(-1,Ui.dp(c,24)));reload();
    }
    private Button tool(Context c,String text,String description){Button b=Ui.button(c,text);b.setBackgroundColor(Color.TRANSPARENT);b.setTextColor(Ui.AQUA);b.setTextSize(23);b.setContentDescription(description);b.setLayoutParams(new LayoutParams(Ui.dp(c,48),Ui.dp(c,48)));return b;}
    private void mapFit(){if(picking)showMap();map.fit();}
    private void showPicker(){
        picking=true;choose.setText("返回");footer.setText("以入口為中心比對出口；同方向可看縮圖");content.removeAllViews();
        content.addView(new MapPicker(getContext(),()->{showMap();reload();}),new FrameLayout.LayoutParams(-1,-1));
    }
    void showMap(){picking=false;choose.setText("重選");footer.setText("單點收合 · 拖曳平移 · 雙指縮放");content.removeAllViews();content.addView(map,new FrameLayout.LayoutParams(-1,-1));}
    void direction(boolean left){collapse.setText(left?"↙":"↘");}
    void reload(){
        android.content.SharedPreferences prefs=MapRepository.prefs(getContext());
        title.setText("地宮 "+MapRepository.get(getContext()).selected().id+"\n"+(prefs.getInt("difficulty",5)==6?"混沌":"惡夢"));map.reload();
        int alpha=Math.round(Math.max(0,Math.min(95,prefs.getInt("opacity",82)))*255/100f);
        setBackground(Ui.background(getContext(),Color.argb(alpha,16,38,48),0x8879cabe,14));
    }
}
