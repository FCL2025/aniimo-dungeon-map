package local.aniimo.dungeonmap.mobile;

import android.content.Context;
import android.view.Gravity;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

final class MapPicker extends LinearLayout {
    private final MapRepository repo;
    private final LinearLayout results;
    private final Runnable selected;
    MapPicker(Context c,Runnable onSelected){
        super(c);setOrientation(VERTICAL);repo=MapRepository.get(c);selected=onSelected;
        setPadding(Ui.dp(c,8),0,Ui.dp(c,8),0);
        ScrollView scroll=new ScrollView(c);LinearLayout body=Ui.column(c);scroll.addView(body);addView(scroll,new LayoutParams(-1,-1));
        TextView title=Ui.text(c,"以入口為中心，選擇出口方向",12,Ui.MUTED);body.addView(title,new LayoutParams(-1,Ui.dp(c,32)));
        int[] order={5,6,7,4,-1,0,3,2,1};
        for(int row=0;row<3;row++){
            LinearLayout line=Ui.row(c);
            for(int col=0;col<3;col++){
                int direction=order[row*3+col];Button b=Ui.button(c,direction<0?"全部":MapRepository.ARROWS[direction]+" "+MapRepository.DIRECTIONS[direction]);
                b.setTextSize(12);b.setOnClickListener(v->show(direction));boolean available=direction<0;
                for(MapRepository.Dungeon map:repo.maps)available|=map.direction==direction;
                b.setEnabled(available);if(!available)b.setAlpha(.35f);line.addView(b,new LayoutParams(0,Ui.dp(c,48),1));
            }
            body.addView(line);
        }
        results=Ui.column(c);body.addView(results);show(-1);
    }
    private void show(int direction){
        results.removeAllViews();Context c=getContext();
        for(MapRepository.Dungeon map:repo.maps){
            if(direction>=0&&map.direction!=direction)continue;
            LinearLayout row=Ui.row(c);row.setPadding(Ui.dp(c,4),Ui.dp(c,6),Ui.dp(c,4),Ui.dp(c,6));row.setBackground(Ui.background(c,Ui.PANEL,0,8));
            ImageView thumbnail=new ImageView(c);thumbnail.setScaleType(ImageView.ScaleType.FIT_CENTER);row.addView(thumbnail,new LayoutParams(Ui.dp(c,68),Ui.dp(c,68)));
            repo.bitmap(map,true,thumbnail::setImageBitmap);
            TextView label=Ui.text(c,map.label(),13,Ui.TEXT);label.setPadding(Ui.dp(c,10),0,0,0);row.addView(label,new LayoutParams(0,-1,1));
            row.setContentDescription("選擇"+map.label());row.setFocusable(true);row.setClickable(true);
            row.setOnClickListener(v->{MapRepository.prefs(c).edit().putInt("map",map.id).apply();selected.run();});
            LayoutParams params=new LayoutParams(-1,Ui.dp(c,80));params.topMargin=Ui.dp(c,6);results.addView(row,params);
        }
    }
}
