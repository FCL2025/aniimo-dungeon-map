package local.aniimo.dungeonmap.mobile;

/** Coordinates are physical display pixels; safe bounds exclude bars and cutouts. */
final class OverlayGeometry {
    static final class Box {
        final int x,y,width,height;
        Box(int x,int y,int width,int height){this.x=x;this.y=y;this.width=width;this.height=height;}
    }
    static int clamp(int value,int min,int max){return Math.max(min,Math.min(Math.max(min,max),value));}
    static Box bubble(Box safe,int size,int x,int y){return new Box(clamp(x,safe.x,safe.x+safe.width-size),clamp(y,safe.y,safe.y+safe.height-size),size,size);}
    static boolean left(Box safe,Box bubble){return bubble.x+bubble.width/2<=safe.x+safe.width/2;}
    static Box panel(Box safe,Box bubble,int width,int height){
        int w=Math.min(width,safe.width),h=Math.min(height,safe.height);
        int x=left(safe,bubble)?bubble.x:bubble.x+bubble.width-w;
        int y=bubble.y+bubble.height/2-h/2;
        return new Box(clamp(x,safe.x,safe.x+safe.width-w),clamp(y,safe.y,safe.y+safe.height-h),w,h);
    }
    static Box restore(Box safe,int size,float x,float y){
        float nx=Float.isFinite(x)?Math.max(0,Math.min(1,x)):0;
        float ny=Float.isFinite(y)?Math.max(0,Math.min(1,y)):.28f;
        return bubble(safe,size,safe.x+Math.round(nx*Math.max(0,safe.width-size)),safe.y+Math.round(ny*Math.max(0,safe.height-size)));
    }
}
