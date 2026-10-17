package local.aniimo.dungeonmap.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.PathEffect;
import android.graphics.DashPathEffect;
import android.graphics.RectF;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.view.View;
import android.view.ViewConfiguration;

final class DungeonView extends View {
    private final MapRepository repo;
    private final SharedPreferences prefs;
    private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG|Paint.FILTER_BITMAP_FLAG);
    private final RectF rect=new RectF();
    private final PathEffect dash;
    private final ScaleGestureDetector zoom;
    private MapRepository.Dungeon map;
    private Bitmap bitmap;
    private boolean failed=false,moved=false,multi=false;
    private int pointer=-1,generation=0;
    private float scale=1,fitScale=1,tx=0,ty=0,lastX,lastY,startX,startY;
    private long started;
    private final int slop;
    private Runnable tap;
    DungeonView(Context c) {
        super(c);repo=MapRepository.get(c);prefs=MapRepository.prefs(c);setFocusable(true);setClickable(true);
        slop=ViewConfiguration.get(c).getScaledTouchSlop();dash=new DashPathEffect(new float[]{Ui.dp(c,2),Ui.dp(c,2)},0);
        setContentDescription("地宮地圖。拖曳移動、雙指縮放。");
        zoom=new ScaleGestureDetector(c,new ScaleGestureDetector.SimpleOnScaleGestureListener(){
            @Override public boolean onScaleBegin(ScaleGestureDetector d){multi=true;return true;}
            @Override public boolean onScale(ScaleGestureDetector d){
                float next=Math.max(fitScale*.6f,Math.min(fitScale*8,scale*d.getScaleFactor()));
                tx=d.getFocusX()-(d.getFocusX()-tx)*next/scale;ty=d.getFocusY()-(d.getFocusY()-ty)*next/scale;scale=next;limitPan();invalidate();return true;
            }
        });
        reload();
    }
    void onTap(Runnable callback){tap=callback;setContentDescription("地宮地圖。單點收合、拖曳移動、雙指縮放。");}
    void reload(){
        MapRepository.Dungeon next=repo.selected();
        if(map==null||next.id!=map.id){map=next;bitmap=null;failed=false;int token=++generation;fit();repo.bitmap(next,false,b->{if(token==generation){bitmap=b;failed=b==null;invalidate();}});}
        invalidate();
    }
    void fit(){
        if(map==null||getWidth()==0||getHeight()==0)return;
        float pad=Ui.dp(getContext(),26);float[] b=map.bounds;
        fitScale=Math.max(.01f,Math.min((getWidth()-pad)/(b[2]-b[0]),(getHeight()-pad)/(b[3]-b[1])));
        scale=fitScale;tx=(getWidth()-(b[0]+b[2])*scale)/2;ty=(getHeight()-(b[1]+b[3])*scale)/2;invalidate();
    }
    private void limitPan(){
        float margin=Ui.dp(getContext(),35);float[] b=map.bounds;
        tx=Math.max(margin-b[2]*scale,Math.min(getWidth()-margin-b[0]*scale,tx));
        ty=Math.max(margin-b[3]*scale,Math.min(getHeight()-margin-b[1]*scale,ty));
    }
    @Override protected void onSizeChanged(int w,int h,int ow,int oh){fit();}
    @Override protected void onDraw(Canvas c){
        super.onDraw(c);if(map==null)return;paint.setStyle(Paint.Style.FILL);paint.setPathEffect(null);
        if(bitmap==null){paint.setTextSize(Ui.dp(getContext(),13));paint.setColor(Ui.MUTED);paint.setTextAlign(Paint.Align.CENTER);c.drawText(failed?"地圖無法載入，請重新開啟 App":"正在載入地圖…",getWidth()/2f,getHeight()/2f,paint);return;}
        rect.set(tx,ty,tx+map.width*scale,ty+map.height*scale);c.drawBitmap(bitmap,null,rect,paint);
        int difficulty=prefs.getInt("difficulty",5);boolean supplements=prefs.getBoolean("supplements",true);
        for(MapRepository.Pin p:map.pins){
            if(!(difficulty==6?p.chaos:p.nightmare)||(!supplements&&p.supplement)||!prefs.getBoolean("category."+p.category,true))continue;
            float x=tx+p.x*scale,y=ty+p.y*scale;boolean chest=p.category.startsWith("chest_");
            float size=Ui.dp(getContext(),p.category.equals("egg")||p.category.equals("entrance")||p.category.equals("exit")?23:17);
            if(x< -size||y< -size||x>getWidth()+size||y>getHeight()+size)continue;
            Bitmap icon=repo.icons.get(p.icon);if(icon!=null){float ratio=Math.min(size/icon.getWidth(),size/icon.getHeight());float w=icon.getWidth()*ratio,h=icon.getHeight()*ratio;rect.set(x-w/2,y-h/2,x+w/2,y+h/2);c.drawBitmap(icon,null,rect,paint);}
            int color=p.category.equals("chest_gold")?Ui.GOLD:0xff9eddf2;
            if(chest){paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(Ui.dp(getContext(),1));paint.setColor(color);c.drawCircle(x,y,size/2+Ui.dp(getContext(),1),paint);paint.setStyle(Paint.Style.FILL);}
            if(p.supplement){paint.setStyle(Paint.Style.STROKE);paint.setPathEffect(dash);paint.setColor(color);c.drawCircle(x,y,size/2+Ui.dp(getContext(),3),paint);paint.setPathEffect(null);paint.setStyle(Paint.Style.FILL);}
            if(chest&&p.floor==2){float w=Ui.dp(getContext(),16),h=Ui.dp(getContext(),11);paint.setColor(Ui.INK);rect.set(x+2,y+3,x+2+w,y+3+h);c.drawRoundRect(rect,3,3,paint);paint.setColor(Ui.TEXT);paint.setTextAlign(Paint.Align.CENTER);paint.setTextSize(Ui.dp(getContext(),8));c.drawText("2F",x+2+w/2,y+3+h-Ui.dp(getContext(),2),paint);}
        }
    }
    @Override public boolean onTouchEvent(MotionEvent e){
        zoom.onTouchEvent(e);
        switch(e.getActionMasked()){
            case MotionEvent.ACTION_DOWN:
                getParent().requestDisallowInterceptTouchEvent(true);pointer=e.getPointerId(0);lastX=startX=e.getX();lastY=startY=e.getY();moved=false;multi=false;started=e.getEventTime();return true;
            case MotionEvent.ACTION_POINTER_DOWN:multi=true;return true;
            case MotionEvent.ACTION_MOVE:
                int index=e.findPointerIndex(pointer);if(index<0)return true;float x=e.getX(index),y=e.getY(index);
                if(Math.hypot(x-startX,y-startY)>slop)moved=true;
                if(!zoom.isInProgress()&&(moved||multi)){tx+=x-lastX;ty+=y-lastY;limitPan();invalidate();}lastX=x;lastY=y;return true;
            case MotionEvent.ACTION_POINTER_UP:
                multi=true;if(e.getPointerId(e.getActionIndex())==pointer){int next=e.getActionIndex()==0?1:0;pointer=e.getPointerId(next);lastX=e.getX(next);lastY=e.getY(next);}return true;
            case MotionEvent.ACTION_UP:
                getParent().requestDisallowInterceptTouchEvent(false);pointer=-1;
                if(!moved&&!multi&&e.getEventTime()-started<450)performClick();return true;
            case MotionEvent.ACTION_CANCEL:pointer=-1;multi=true;getParent().requestDisallowInterceptTouchEvent(false);return true;
            default:return true;
        }
    }
    @Override public boolean performClick(){super.performClick();if(tap!=null)tap.run();return true;}
}
