package local.aniimo.dungeonmap.mobile;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.app.AppOpsManager;
import android.app.KeyguardManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.content.res.Configuration;
import android.graphics.Insets;
import android.graphics.PixelFormat;
import android.graphics.Point;
import android.graphics.Rect;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.view.WindowMetrics;
import android.view.animation.DecelerateInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.Toast;

public final class OverlayService extends Service {
    static final String START="local.aniimo.mobile.START",STOP="local.aniimo.mobile.STOP",COLLAPSE="local.aniimo.mobile.COLLAPSE";
    private static volatile boolean running=false;
    private static final String CHANNEL="floating-map";
    private static final int NOTICE=41;
    private final Handler main=new Handler(Looper.getMainLooper());
    private Context visual;
    private WindowManager wm;
    private WindowManager.LayoutParams params;
    private FrameLayout root;
    private ImageButton bubble;
    private MapPanel panel;
    private SharedPreferences prefs;
    private OverlayGeometry.Box safe,buttonBox;
    private String orientation="portrait";
    private boolean expanded=false,destroyed=false,receiverRegistered=false;
    private ValueAnimator animation;
    private AppOpsManager appOps;
    private final AppOpsManager.OnOpChangedListener permissionChange=(op,name)->{
        if(getPackageName().equals(name))main.post(()->{if(!Settings.canDrawOverlays(this))stopSelf();});
    };
    private final SharedPreferences.OnSharedPreferenceChangeListener settingsChange=(p,key)->{
        if(destroyed||panel==null||key==null||key.startsWith("position."))return;
        panel.reload();if(key.equals("size")&&expanded&&animation==null)layoutExpanded();
    };
    private final BroadcastReceiver screenState=new BroadcastReceiver(){
        @Override public void onReceive(Context c,Intent intent){
            if(root==null)return;
            if(Intent.ACTION_SCREEN_OFF.equals(intent.getAction())){collapseImmediately();root.setVisibility(View.GONE);}
            else if(Intent.ACTION_USER_PRESENT.equals(intent.getAction())||
                (Intent.ACTION_SCREEN_ON.equals(intent.getAction())&&!getSystemService(KeyguardManager.class).isKeyguardLocked())){
                restoreGeometry();root.setVisibility(View.VISIBLE);
            }
        }
    };
    static boolean isRunning(){return running;}
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public void onCreate(){super.onCreate();prefs=MapRepository.prefs(this);}
    @Override public int onStartCommand(Intent intent,int flags,int id){
        String action=intent==null?null:intent.getAction();
        if(STOP.equals(action)){stopSelf();return START_NOT_STICKY;}
        if(COLLAPSE.equals(action)){if(root!=null)collapseImmediately();return START_NOT_STICKY;}
        if(!Settings.canDrawOverlays(this)){stopSelf();return START_NOT_STICKY;}
        if(root!=null)return START_NOT_STICKY;
        try{
            Notification notice=notification();
            if(Build.VERSION.SDK_INT>=34)startForeground(NOTICE,notice,ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);else startForeground(NOTICE,notice);
            createOverlay();running=true;
        }catch(RuntimeException error){
            android.util.Log.e("AniimoOverlay","Unable to start floating map",error);
            Toast.makeText(this,"無法開啟浮窗，請確認顯示在其他應用程式上層的權限",Toast.LENGTH_LONG).show();stopSelf();
        }
        return START_NOT_STICKY;
    }
    private Notification notification(){
        NotificationManager manager=getSystemService(NotificationManager.class);
        NotificationChannel channel=new NotificationChannel(CHANNEL,"浮動地圖",NotificationManager.IMPORTANCE_LOW);channel.setDescription("浮窗使用中，可隨時收合或關閉");channel.setShowBadge(false);manager.createNotificationChannel(channel);
        int immutable=PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE;
        PendingIntent settings=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),immutable);
        PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,OverlayService.class).setAction(STOP),immutable);
        PendingIntent collapse=PendingIntent.getService(this,2,new Intent(this,OverlayService.class).setAction(COLLAPSE),immutable);
        return new Notification.Builder(this,CHANNEL).setSmallIcon(R.drawable.ic_notification).setContentTitle("伊莫浮動地圖已開啟")
            .setContentText("點此選圖或調整設定").setContentIntent(settings).setOngoing(true).setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE).setCategory(Notification.CATEGORY_SERVICE)
            .addAction(new Notification.Action.Builder(null,"收合地圖",collapse).build())
            .addAction(new Notification.Action.Builder(null,"關閉浮窗",stop).build()).build();
    }
    private int dp(float value){return Ui.dp(this,value);}
    private void createOverlay(){
        android.view.Display display=getSystemService(android.hardware.display.DisplayManager.class).getDisplay(android.view.Display.DEFAULT_DISPLAY);
        if(display==null)throw new IllegalStateException("No display for floating map");
        visual=createDisplayContext(display);
        if(Build.VERSION.SDK_INT>=30)visual=visual.createWindowContext(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,null);
        visual=new android.view.ContextThemeWrapper(visual,R.style.AppTheme);wm=visual.getSystemService(WindowManager.class);
        root=new FrameLayout(visual);root.setBackgroundColor(android.graphics.Color.TRANSPARENT);
        bubble=new ImageButton(visual);bubble.setImageResource(R.drawable.generated_egg);bubble.setScaleType(android.widget.ImageView.ScaleType.FIT_CENTER);
        bubble.setPadding(dp(9),dp(9),dp(9),dp(9));bubble.setBackground(Ui.background(visual,0xed142d39,Ui.GOLD,27));
        bubble.setContentDescription("展開小地圖，拖曳可調整位置");bubble.setFocusable(true);bubble.setOnClickListener(v->expand());
        installDrag();root.addView(bubble,new FrameLayout.LayoutParams(dp(54),dp(54)));
        panel=new MapPanel(visual,this::collapse);panel.setVisibility(View.GONE);root.addView(panel,new FrameLayout.LayoutParams(-1,-1));
        params=new WindowManager.LayoutParams(dp(54),dp(54),WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL|WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN|WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,PixelFormat.TRANSLUCENT);
        params.gravity=Gravity.TOP|Gravity.LEFT;params.setTitle("Aniimo floating map");params.windowAnimations=0;
        if(Build.VERSION.SDK_INT>=28)params.layoutInDisplayCutoutMode=WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        if(Build.VERSION.SDK_INT>=30)params.setFitInsetsTypes(0);
        readSafeArea();buttonBox=readPosition();applyBox(buttonBox,false);
        root.setOnApplyWindowInsetsListener((v,insets)->{
            if(Build.VERSION.SDK_INT<30){
                OverlayGeometry.Box previous=safe;readSafeArea(insets);
                if(previous.x!=safe.x||previous.y!=safe.y||previous.width!=safe.width||previous.height!=safe.height){
                    main.post(()->{if(!destroyed){collapseImmediately();buttonBox=readPosition();applyBox(buttonBox,true);}});
                }
            }
            return insets;
        });
        wm.addView(root,params);root.requestApplyInsets();
        prefs.registerOnSharedPreferenceChangeListener(settingsChange);
        appOps=getSystemService(AppOpsManager.class);appOps.startWatchingMode(AppOpsManager.OPSTR_SYSTEM_ALERT_WINDOW,getPackageName(),permissionChange);
        IntentFilter filter=new IntentFilter();filter.addAction(Intent.ACTION_SCREEN_OFF);filter.addAction(Intent.ACTION_SCREEN_ON);filter.addAction(Intent.ACTION_USER_PRESENT);
        if(Build.VERSION.SDK_INT>=33)registerReceiver(screenState,filter,Context.RECEIVER_NOT_EXPORTED);else registerReceiver(screenState,filter);receiverRegistered=true;
        if(getSystemService(KeyguardManager.class).isKeyguardLocked())root.setVisibility(View.GONE);
    }
    private void readSafeArea(){readSafeArea(root==null?null:root.getRootWindowInsets());}
    private void readSafeArea(WindowInsets legacyInsets){
        int left=0,top=0,right,bottom;
        if(Build.VERSION.SDK_INT>=30){
            WindowMetrics metrics=wm.getCurrentWindowMetrics();Rect bounds=metrics.getBounds();Insets insets=metrics.getWindowInsets().getInsetsIgnoringVisibility(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());
            left=bounds.left+insets.left;top=bounds.top+insets.top;right=bounds.right-insets.right;bottom=bounds.bottom-insets.bottom;
            orientation=bounds.width()>=bounds.height()?"landscape":"portrait";
        }else{
            Point size=new Point();wm.getDefaultDisplay().getRealSize(size);right=size.x;bottom=size.y;orientation=size.x>=size.y?"landscape":"portrait";
            if(legacyInsets!=null){
                left=legacyInsets.getStableInsetLeft();top=legacyInsets.getStableInsetTop();right-=legacyInsets.getStableInsetRight();bottom-=legacyInsets.getStableInsetBottom();
                if(Build.VERSION.SDK_INT>=28&&legacyInsets.getDisplayCutout()!=null){
                    android.view.DisplayCutout cutout=legacyInsets.getDisplayCutout();left=Math.max(left,cutout.getSafeInsetLeft());top=Math.max(top,cutout.getSafeInsetTop());right=Math.min(right,size.x-cutout.getSafeInsetRight());bottom=Math.min(bottom,size.y-cutout.getSafeInsetBottom());
                }
            }else{top=dp(24);if(orientation.equals("landscape"))right-=dp(48);else bottom-=dp(48);}
        }
        int margin=dp(8);safe=new OverlayGeometry.Box(left+margin,top+margin,Math.max(dp(54),right-left-2*margin),Math.max(dp(54),bottom-top-2*margin));
    }
    private OverlayGeometry.Box readPosition(){return OverlayGeometry.restore(safe,dp(54),prefs.getFloat("position."+orientation+".x",0),prefs.getFloat("position."+orientation+".y",.28f));}
    private void savePosition(){
        prefs.edit().putFloat("position."+orientation+".x",(buttonBox.x-safe.x)/(float)Math.max(1,safe.width-buttonBox.width))
            .putFloat("position."+orientation+".y",(buttonBox.y-safe.y)/(float)Math.max(1,safe.height-buttonBox.height)).apply();
    }
    private void applyBox(OverlayGeometry.Box b,boolean update){
        params.x=b.x;params.y=b.y;params.width=b.width;params.height=b.height;
        if(update&&root!=null&&root.isAttachedToWindow())try{wm.updateViewLayout(root,params);}catch(IllegalArgumentException|SecurityException error){stopSelf();}
    }
    private OverlayGeometry.Box panelBox(){
        float ratio=Math.max(65,Math.min(120,prefs.getInt("size",100)))/100f;
        return OverlayGeometry.panel(safe,buttonBox,dp(360*ratio),dp(370*ratio));
    }
    private void layoutExpanded(){OverlayGeometry.Box target=panelBox();panel.direction(OverlayGeometry.left(safe,buttonBox));applyBox(target,true);}
    private void expand(){
        if(expanded||animation!=null||destroyed)return;expanded=true;panel.showMap();panel.reload();panel.setVisibility(View.VISIBLE);bubble.setVisibility(View.GONE);
        OverlayGeometry.Box target=panelBox();panel.direction(OverlayGeometry.left(safe,buttonBox));applyBox(target,true);animatePanel(target,true);
    }
    private void collapse(){
        if(!expanded||animation!=null||destroyed)return;animatePanel(new OverlayGeometry.Box(params.x,params.y,params.width,params.height),false);
    }
    private void animatePanel(OverlayGeometry.Box target,boolean opening){
        float sx=buttonBox.width/(float)target.width,sy=buttonBox.height/(float)target.height,dx=buttonBox.x-target.x,dy=buttonBox.y-target.y;
        panel.setPivotX(0);panel.setPivotY(0);
        animation=ValueAnimator.ofFloat(opening?0:1,opening?1:0);animation.setDuration(ValueAnimator.areAnimatorsEnabled()?(opening?230:180):0);animation.setInterpolator(new DecelerateInterpolator(2));
        animation.addUpdateListener(a->{float t=(float)a.getAnimatedValue();panel.setScaleX(sx+(1-sx)*t);panel.setScaleY(sy+(1-sy)*t);panel.setTranslationX(dx*(1-t));panel.setTranslationY(dy*(1-t));panel.setAlpha(t);});
        animation.addListener(new AnimatorListenerAdapter(){@Override public void onAnimationEnd(Animator a){animation=null;if(!opening)collapseImmediately();else resetTransform();}});animation.start();
    }
    private void cancelAnimation(){if(animation!=null){animation.removeAllListeners();animation.removeAllUpdateListeners();animation.cancel();animation=null;}}
    private void resetTransform(){panel.setScaleX(1);panel.setScaleY(1);panel.setTranslationX(0);panel.setTranslationY(0);panel.setAlpha(1);}
    private void collapseImmediately(){
        if(root==null)return;cancelAnimation();expanded=false;panel.setVisibility(View.GONE);resetTransform();bubble.setVisibility(View.VISIBLE);applyBox(buttonBox,true);
    }
    private void restoreGeometry(){if(root==null)return;collapseImmediately();readSafeArea();buttonBox=readPosition();applyBox(buttonBox,true);}
    private void installDrag(){
        int slop=ViewConfiguration.get(visual).getScaledTouchSlop();
        bubble.setOnTouchListener(new View.OnTouchListener(){
            float startX,startY;int bx,by;boolean moved,multi;
            @Override public boolean onTouch(View v,MotionEvent event){
                if(animation!=null)return true;
                switch(event.getActionMasked()){
                    case MotionEvent.ACTION_DOWN:startX=event.getRawX();startY=event.getRawY();bx=buttonBox.x;by=buttonBox.y;moved=false;multi=false;return true;
                    case MotionEvent.ACTION_POINTER_DOWN:multi=true;return true;
                    case MotionEvent.ACTION_MOVE:
                        if(multi)return true;float dx=event.getRawX()-startX,dy=event.getRawY()-startY;if(Math.hypot(dx,dy)>slop)moved=true;
                        if(moved){buttonBox=OverlayGeometry.bubble(safe,dp(54),bx+Math.round(dx),by+Math.round(dy));applyBox(buttonBox,true);}return true;
                    case MotionEvent.ACTION_UP:
                        if(moved){dock();savePosition();}else if(!multi)v.performClick();return true;
                    case MotionEvent.ACTION_CANCEL:savePosition();return true;
                    default:return true;
                }
            }
        });
    }
    private void dock(){
        if(!prefs.getBoolean("snap",false))return;
        int target=OverlayGeometry.left(safe,buttonBox)?safe.x:safe.x+safe.width-buttonBox.width;
        // The actual native window follows the dock animation, including its touch bounds.
        int from=buttonBox.x,atY=buttonBox.y;animation=ValueAnimator.ofInt(from,target);animation.setDuration(ValueAnimator.areAnimatorsEnabled()?160:0);animation.setInterpolator(new DecelerateInterpolator());
        animation.addUpdateListener(a->{buttonBox=OverlayGeometry.bubble(safe,dp(54),(int)a.getAnimatedValue(),atY);applyBox(buttonBox,true);});
        animation.addListener(new AnimatorListenerAdapter(){@Override public void onAnimationEnd(Animator a){animation=null;savePosition();}});animation.start();
    }
    @Override public void onConfigurationChanged(Configuration config){super.onConfigurationChanged(config);if(root!=null)main.post(this::restoreGeometry);}
    @Override public void onDestroy(){
        destroyed=true;running=false;cancelAnimation();main.removeCallbacksAndMessages(null);
        if(prefs!=null)prefs.unregisterOnSharedPreferenceChangeListener(settingsChange);
        if(appOps!=null)appOps.stopWatchingMode(permissionChange);
        if(receiverRegistered)unregisterReceiver(screenState);
        if(root!=null&&root.isAttachedToWindow())try{wm.removeViewImmediate(root);}catch(IllegalArgumentException ignored){}
        root=null;stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();
    }
}
