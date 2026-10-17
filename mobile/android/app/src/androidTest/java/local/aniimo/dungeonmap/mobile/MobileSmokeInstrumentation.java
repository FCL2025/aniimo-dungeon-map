package local.aniimo.dungeonmap.mobile;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.Instrumentation;
import android.app.UiAutomation;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.List;

/** Real touch injection through Android's input dispatcher. Run only on a disposable emulator. */
public final class MobileSmokeInstrumentation extends Instrumentation {
    private static final String BUBBLE="展開小地圖，拖曳可調整位置";
    private static final String MAP="地宮地圖。單點收合、拖曳移動、雙指縮放。";
    private UiAutomation automation;
    private final List<String> checks=new ArrayList<>();
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    @Override public void onStart(){
        Bundle result=new Bundle();
        try{
            require(Build.HARDWARE.contains("ranchu")||Build.HARDWARE.contains("goldfish"),"Tests require a disposable Android emulator");
            require(Settings.canDrawOverlays(getTargetContext()),"Grant overlay permission before running tests");
            automation=getUiAutomation();AccessibilityServiceInfo info=automation.getServiceInfo();
            info.flags|=AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;automation.setServiceInfo(info);
            runOnMainSync(()->{
                getTargetContext().stopService(new Intent(getTargetContext(),OverlayService.class));
                MapRepository.prefs(getTargetContext()).edit().clear().putBoolean("notificationAsked",true).putInt("size",65).commit();
            });
            openMain();
            click("開啟浮動地圖");waitFor(BUBBLE);key(KeyEvent.KEYCODE_HOME);pause();
            Rect left=bounds(waitFor(BUBBLE));require(left.width()<200,"Collapsed window is button sized");
            click(BUBBLE);Rect leftMap=bounds(waitFor(MAP));require(leftMap.left==left.left,"Left button opens to the right");
            screenshot("native-left");checks.add("cross-app overlay and left expansion");
            swipe(leftMap.centerX(),leftMap.centerY(),leftMap.centerX()+80,leftMap.centerY()+60);
            require(find(MAP)!=null,"Map pan must not collapse");
            Bitmap before=automation.takeScreenshot();pinch(leftMap.centerX(),leftMap.centerY());pause();
            require(find(MAP)!=null,"Pinch must not collapse");Bitmap after=automation.takeScreenshot();
            require(different(before,after,leftMap)>100,"Pinch changes the rendered map");before.recycle();after.recycle();
            checks.add("pan and two-finger zoom do not collapse");
            click("顯示整張地圖");require(find(MAP)!=null,"Fit button must not collapse");
            click(MAP);Rect collapsed=bounds(waitFor(BUBBLE));require(collapsed.equals(left),"Tap restores the same button position");
            int width=getTargetContext().getResources().getDisplayMetrics().widthPixels;
            swipe(left.centerX(),left.centerY(),width-100,left.centerY()+100);Rect right=bounds(waitFor(BUBBLE));
            require(right.centerX()>width/2,"Bubble can be dragged to right");click(BUBBLE);
            Rect rightMap=bounds(waitFor(MAP));require(rightMap.right==right.right,"Right button opens to the left");
            screenshot("native-right");click("重新選擇地圖");
            AccessibilityNodeInfo candidate=null;
            for(int i=0;i<8&&candidate==null;i++){
                candidate=findPrefix("選擇地宮 ");
                if(candidate==null)swipe(rightMap.centerX(),rightMap.bottom-15,rightMap.centerX(),rightMap.top+20);
            }
            require(candidate!=null,"Map choices remain reachable at minimum overlay size");
            click(candidate);waitFor(MAP);checks.add("right expansion, map picker at 65% size, toolbar and single-tap collapse");
            click(MAP);Rect saved=bounds(waitFor(BUBBLE));
            runOnMainSync(()->getTargetContext().stopService(new Intent(getTargetContext(),OverlayService.class)));pause();
            require(find(BUBBLE)==null,"Stopping removes native overlay");
            openMain();click("開啟浮動地圖");
            require(bounds(waitFor(BUBBLE)).equals(saved),"Button position survives service restart");
            click("放開按鈕後靠邊吸附");Rect b=bounds(waitFor(BUBBLE));swipe(b.centerX(),b.centerY(),width*3/4,b.centerY()+80);
            b=bounds(waitFor(BUBBLE));require(b.right>width-40,"Optional docking snaps to right edge");
            checks.add("position persistence, stop/restart and optional edge docking");
            // A phone launcher can lock portrait even when UiAutomation requests rotation.
            openMain();click(BUBBLE);automation.setRotation(UiAutomation.ROTATION_FREEZE_90);pause();
            Rect landscape=bounds(waitFor(BUBBLE));require(find(MAP)==null,"Rotation collapses the map");
            click(BUBBLE);Rect landscapeMap=bounds(waitFor(MAP));Bitmap landscapeShot=automation.takeScreenshot();
            require(landscapeMap.left>=0&&landscapeMap.top>=0&&landscapeMap.right<=landscapeShot.getWidth()&&landscapeMap.bottom<=landscapeShot.getHeight(),"Landscape overlay stays on screen");
            landscapeShot.recycle();screenshot("native-landscape");
            automation.setRotation(UiAutomation.ROTATION_FREEZE_0);pause();require(bounds(waitFor(BUBBLE)).equals(b),"Portrait position restored after rotation");
            checks.add("rotation collapses safely and restores separate orientation positions");
            runOnMainSync(()->getTargetContext().stopService(new Intent(getTargetContext(),OverlayService.class)));pause();
            require(find(BUBBLE)==null&&find(MAP)==null,"No overlay remains after stop");
            result.putString("stream","\nPASS: "+String.join("\nPASS: ",checks)+"\n");finish(-1,result);
        }catch(Throwable error){result.putString("stream","\nFAIL after "+checks+"\n"+android.util.Log.getStackTraceString(error));finish(0,result);}
        finally{if(automation!=null)automation.setRotation(UiAutomation.ROTATION_UNFREEZE);}
    }
    private static void require(boolean condition,String message){if(!condition)throw new AssertionError(message);}
    private static void pause(){SystemClock.sleep(700);}
    private void openMain(){runOnMainSync(()->getTargetContext().startActivity(new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)));pause();}
    private AccessibilityNodeInfo find(String label){return findLabel(label,false);}
    private AccessibilityNodeInfo findPrefix(String label){return findLabel(label,true);}
    private AccessibilityNodeInfo findLabel(String label,boolean prefix){
        for(AccessibilityWindowInfo window:automation.getWindows()){
            AccessibilityNodeInfo found=walk(window.getRoot(),label,prefix);if(found!=null)return found;
        }return null;
    }
    private AccessibilityNodeInfo walk(AccessibilityNodeInfo node,String label,boolean prefix){
        if(node==null)return null;
        String description=String.valueOf(node.getContentDescription()),text=String.valueOf(node.getText());
        Rect r=bounds(node);
        if(node.isVisibleToUser()&&r.width()>0&&r.height()>0&&(prefix?(description.startsWith(label)||text.startsWith(label)):(description.equals(label)||text.equals(label))))return node;
        for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo found=walk(node.getChild(i),label,prefix);if(found!=null)return found;}return null;
    }
    private AccessibilityNodeInfo waitFor(String label){for(int i=0;i<25;i++){AccessibilityNodeInfo n=find(label);if(n!=null){pause();return find(label);}SystemClock.sleep(200);}throw new AssertionError("Missing control: "+label);}
    private static Rect bounds(AccessibilityNodeInfo node){Rect r=new Rect();node.getBoundsInScreen(r);return r;}
    private void click(String label){click(waitFor(label));}
    private void click(AccessibilityNodeInfo node){Rect r=bounds(node);long t=SystemClock.uptimeMillis();touch(t,t,MotionEvent.ACTION_DOWN,r.centerX(),r.centerY());touch(t,t+60,MotionEvent.ACTION_UP,r.centerX(),r.centerY());pause();}
    private void key(int code){automation.injectInputEvent(new KeyEvent(KeyEvent.ACTION_DOWN,code),true);automation.injectInputEvent(new KeyEvent(KeyEvent.ACTION_UP,code),true);pause();}
    private void touch(long down,long time,int action,float x,float y){MotionEvent e=MotionEvent.obtain(down,time,action,x,y,0);e.setSource(InputDevice.SOURCE_TOUCHSCREEN);automation.injectInputEvent(e,true);e.recycle();}
    private void swipe(int x1,int y1,int x2,int y2){long t=SystemClock.uptimeMillis();touch(t,t,0,x1,y1);for(int i=1;i<=15;i++){SystemClock.sleep(20);touch(t,SystemClock.uptimeMillis(),2,x1+(x2-x1)*i/15f,y1+(y2-y1)*i/15f);}touch(t,SystemClock.uptimeMillis(),1,x2,y2);pause();}
    private void pinch(int x,int y){
        long t=SystemClock.uptimeMillis();touch(t,t,MotionEvent.ACTION_DOWN,x-35,y);
        multi(t,MotionEvent.ACTION_POINTER_DOWN|(1<<MotionEvent.ACTION_POINTER_INDEX_SHIFT),x,y,35);
        for(int i=1;i<=15;i++){SystemClock.sleep(25);multi(t,MotionEvent.ACTION_MOVE,x,y,35+i*5);}
        multi(t,MotionEvent.ACTION_POINTER_UP|(1<<MotionEvent.ACTION_POINTER_INDEX_SHIFT),x,y,110);
        touch(t,SystemClock.uptimeMillis(),MotionEvent.ACTION_UP,x-110,y);
    }
    private void multi(long down,int action,int x,int y,int radius){
        MotionEvent.PointerProperties[] props=new MotionEvent.PointerProperties[2];MotionEvent.PointerCoords[] coords=new MotionEvent.PointerCoords[2];
        for(int i=0;i<2;i++){props[i]=new MotionEvent.PointerProperties();props[i].id=i;props[i].toolType=MotionEvent.TOOL_TYPE_FINGER;coords[i]=new MotionEvent.PointerCoords();coords[i].x=x+(i==0?-radius:radius);coords[i].y=y;coords[i].pressure=1;coords[i].size=1;}
        MotionEvent e=MotionEvent.obtain(down,SystemClock.uptimeMillis(),action,2,props,coords,0,0,1,1,0,0,InputDevice.SOURCE_TOUCHSCREEN,0);automation.injectInputEvent(e,true);e.recycle();
    }
    private int different(Bitmap a,Bitmap b,Rect r){int count=0;for(int y=r.top+10;y<r.bottom-10;y+=3)for(int x=r.left+10;x<r.right-10;x+=3)if(a.getPixel(x,y)!=b.getPixel(x,y))count++;return count;}
    private void screenshot(String name)throws Exception{Bitmap bitmap=automation.takeScreenshot();File file=new File(getTargetContext().getExternalFilesDir(null),name+".png");try(FileOutputStream out=new FileOutputStream(file)){bitmap.compress(Bitmap.CompressFormat.PNG,100,out);}bitmap.recycle();}
}
