package local.aniimo.dungeonmap.mobile;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.View;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

public final class MainActivity extends Activity {
    private SharedPreferences prefs;
    private DungeonView map;
    private TextView status,title;
    private Button start,stop,nightmare,chaos;
    private boolean pendingOverlay=false;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final SharedPreferences.OnSharedPreferenceChangeListener changes=(p,k)->{if(map!=null){map.reload();refreshLabels();}};
    @Override public void onCreate(Bundle state){
        super.onCreate(state);prefs=MapRepository.prefs(this);pendingOverlay=state!=null&&state.getBoolean("pendingOverlay");
        LinearLayout root=Ui.column(this);root.setBackgroundColor(Ui.INK);
        root.setOnApplyWindowInsetsListener((v,insets)->{
            if(Build.VERSION.SDK_INT>=30){Insets i=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());v.setPadding(i.left,i.top,i.right,i.bottom);}
            else v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            return insets;
        });
        setContentView(root);root.requestApplyInsets();
        ScrollView scroll=new ScrollView(this);root.addView(scroll,new LinearLayout.LayoutParams(-1,-1));
        LinearLayout body=Ui.column(this);int pad=Ui.dp(this,20);body.setPadding(pad,Ui.dp(this,20),pad,Ui.dp(this,28));scroll.addView(body);
        TextView eyebrow=Ui.text(this,"伊莫 · 搶蛋大作戰",12,Ui.AQUA);body.addView(eyebrow);
        TextView heading=Ui.text(this,"隨手看圖，收起繼續玩。",24,Ui.TEXT);Ui.heading(heading);heading.setPadding(0,Ui.dp(this,10),0,Ui.dp(this,10));body.addView(heading);
        TextView intro=Ui.text(this,"拖動蛋形按鈕調整位置，點一下展開。\n單點地圖收合；拖曳、雙指縮放不會收合。",13,Ui.MUTED);intro.setLineSpacing(Ui.dp(this,3),1);body.addView(intro);
        LinearLayout actions=Ui.row(this);actions.setPadding(0,Ui.dp(this,14),0,0);
        start=Ui.button(this,"開啟浮動地圖");start.setBackgroundTintList(ColorStateList.valueOf(Ui.AQUA));start.setTextColor(Ui.INK);start.setOnClickListener(v->requestOverlay());actions.addView(start,Ui.weight());
        stop=Ui.button(this,"關閉浮窗");stop.setOnClickListener(v->{stopService(new Intent(this,OverlayService.class));handler.postDelayed(this::refreshLabels,200);});actions.addView(stop,Ui.weight());body.addView(actions);
        status=Ui.text(this,"",12,Ui.GOLD);status.setPadding(0,Ui.dp(this,6),0,Ui.dp(this,12));body.addView(status);
        try{MapRepository.get(this);}catch(RuntimeException error){body.addView(Ui.text(this,"離線地圖資料無法載入，請重新安裝 APK。",14,Ui.GOLD));start.setEnabled(false);return;}
        LinearLayout mapBar=Ui.row(this);title=Ui.text(this,"",14,Ui.TEXT);Ui.heading(title);mapBar.addView(title,Ui.weight());
        Button choose=Ui.button(this,"選擇出口");choose.setOnClickListener(v->chooseMap());mapBar.addView(choose);body.addView(mapBar);
        map=new DungeonView(this);map.setBackground(Ui.background(this,Ui.PANEL,0,12));body.addView(map,new LinearLayout.LayoutParams(-1,Ui.dp(this,290)));
        LinearLayout difficulty=Ui.row(this);nightmare=Ui.button(this,"惡夢");chaos=Ui.button(this,"混沌");
        nightmare.setOnClickListener(v->prefs.edit().putInt("difficulty",5).apply());chaos.setOnClickListener(v->prefs.edit().putInt("difficulty",6).apply());
        difficulty.addView(nightmare,Ui.weight());difficulty.addView(chaos,Ui.weight());Button fit=Ui.button(this,"顯示全圖");fit.setOnClickListener(v->map.fit());difficulty.addView(fit,Ui.weight());body.addView(difficulty);
        TextView note=Ui.text(this,"標記是候選位置，不保證每場出現。虛線為房間模組補充點；2F 為較高的寶箱。",11,Ui.MUTED);note.setPadding(0,Ui.dp(this,8),0,Ui.dp(this,18));body.addView(note);
        TextView options=Ui.text(this,"浮窗設定",16,Ui.TEXT);Ui.heading(options);body.addView(options);
        addSwitch(body,"放開按鈕後靠邊吸附","snap",false);
        addSlider(body,"地圖底色", "opacity",0,95,82);
        addSlider(body,"小地圖大小", "size",65,120,100);
        addSwitch(body,"顯示房間模組補充點","supplements",true);
        addSwitch(body,"顯示蛋巢","category.egg",true);
        addSwitch(body,"顯示金色寶箱","category.chest_gold",true);
        addSwitch(body,"顯示琉璃寶箱","category.chest_glass",true);
        Button permission=Ui.button(this,"浮窗權限設定");permission.setOnClickListener(v->openOverlaySettings());body.addView(permission);
        TextView footer=Ui.text(this,"手機版 0.1.0 · 七張離線地宮\n開啟浮窗後切回遊戲即可。也可從通知列關閉浮窗。",11,Ui.MUTED);footer.setPadding(0,Ui.dp(this,16),0,0);body.addView(footer);
        refreshLabels();
    }
    private void addSwitch(LinearLayout body,String text,String key,boolean fallback){
        Switch control=new Switch(this);control.setText(text);control.setTextSize(13);control.setTextColor(Ui.TEXT);control.setMinHeight(Ui.dp(this,52));control.setChecked(prefs.getBoolean(key,fallback));
        control.setOnCheckedChangeListener((v,checked)->prefs.edit().putBoolean(key,checked).apply());body.addView(control);
    }
    private void addSlider(LinearLayout body,String label,String key,int min,int max,int fallback){
        int value=Math.max(min,Math.min(max,prefs.getInt(key,fallback)));TextView text=Ui.text(this,label+" · "+value+"%",13,Ui.MUTED);body.addView(text);
        SeekBar slider=new SeekBar(this);slider.setMax(max-min);slider.setProgress(value-min);slider.setContentDescription(label);
        slider.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener(){
            public void onProgressChanged(SeekBar s,int n,boolean user){text.setText(label+" · "+(n+min)+"%");if(user)prefs.edit().putInt(key,n+min).apply();}
            public void onStartTrackingTouch(SeekBar s){}public void onStopTrackingTouch(SeekBar s){}
        });body.addView(slider,new LinearLayout.LayoutParams(-1,Ui.dp(this,44)));
    }
    private void chooseMap(){
        final AlertDialog dialog=new AlertDialog.Builder(this).setTitle("選擇本場地圖").setNegativeButton("取消",null).create();
        MapPicker picker=new MapPicker(this,()->{dialog.dismiss();map.reload();refreshLabels();});dialog.setView(picker);dialog.show();
        int height=Math.min(Ui.dp(this,560),(int)(getResources().getDisplayMetrics().heightPixels*.85));dialog.getWindow().setLayout(-1,height);
    }
    private void requestOverlay(){
        if(!Settings.canDrawOverlays(this)){pendingOverlay=true;openOverlaySettings();return;}
        requestNotificationThenStart();
    }
    private void openOverlaySettings(){
        try{startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,Uri.parse("package:"+getPackageName())));}
        catch(ActivityNotFoundException error){pendingOverlay=false;Toast.makeText(this,"請到系統設定允許本 App 顯示在其他應用程式上層",Toast.LENGTH_LONG).show();}
    }
    private void requestNotificationThenStart(){
        if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED&&!prefs.getBoolean("notificationAsked",false)){
            prefs.edit().putBoolean("notificationAsked",true).apply();requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},7);return;
        }
        startOverlay();
    }
    private void startOverlay(){
        if(!Settings.canDrawOverlays(this)){refreshLabels();return;}
        try{startForegroundService(new Intent(this,OverlayService.class).setAction(OverlayService.START));handler.postDelayed(this::refreshLabels,350);}
        catch(RuntimeException error){Toast.makeText(this,"暫時無法開啟浮窗，請保持 App 在前景後再試一次",Toast.LENGTH_LONG).show();}
    }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){super.onRequestPermissionsResult(request,permissions,results);if(request==7)startOverlay();}
    private void refreshLabels(){
        if(status==null)return;boolean running=OverlayService.isRunning();stop.setEnabled(running);
        start.setText(running?"浮動地圖已開啟":"開啟浮動地圖");start.setEnabled(!running);
        status.setText(running?"浮窗已開啟，切回遊戲即可使用。":Settings.canDrawOverlays(this)?"已取得浮窗權限，隨時可以開啟。":"首次開啟時，請允許顯示在其他應用程式上層。");
        if(title!=null){title.setText("地宮 "+MapRepository.get(this).selected().id);int d=prefs.getInt("difficulty",5);nightmare.setTextColor(d==5?Ui.AQUA:Ui.MUTED);chaos.setTextColor(d==6?Ui.AQUA:Ui.MUTED);}
    }
    @Override protected void onResume(){super.onResume();if(prefs!=null)prefs.registerOnSharedPreferenceChangeListener(changes);if(map!=null)map.reload();refreshLabels();if(pendingOverlay){pendingOverlay=false;if(Settings.canDrawOverlays(this))requestNotificationThenStart();}}
    @Override protected void onPause(){super.onPause();if(prefs!=null)prefs.unregisterOnSharedPreferenceChangeListener(changes);handler.removeCallbacksAndMessages(null);}
    @Override protected void onSaveInstanceState(Bundle state){super.onSaveInstanceState(state);state.putBoolean("pendingOverlay",pendingOverlay);}
}
