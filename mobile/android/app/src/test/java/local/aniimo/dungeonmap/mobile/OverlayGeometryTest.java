package local.aniimo.dungeonmap.mobile;

import org.junit.Test;
import java.util.Random;
import static org.junit.Assert.*;

public final class OverlayGeometryTest {
    private void inside(OverlayGeometry.Box safe,OverlayGeometry.Box child){
        assertTrue(child.x>=safe.x);assertTrue(child.y>=safe.y);
        assertTrue(child.x+child.width<=safe.x+safe.width);assertTrue(child.y+child.height<=safe.y+safe.height);
    }
    @Test public void expandsInwardFromEitherEdge(){
        OverlayGeometry.Box safe=new OverlayGeometry.Box(30,70,1020,2100);
        OverlayGeometry.Box left=OverlayGeometry.bubble(safe,144,30,900),right=OverlayGeometry.bubble(safe,144,906,900);
        assertTrue(OverlayGeometry.left(safe,left));assertFalse(OverlayGeometry.left(safe,right));
        OverlayGeometry.Box a=OverlayGeometry.panel(safe,left,900,1000),b=OverlayGeometry.panel(safe,right,900,1000);
        assertEquals(left.x,a.x);assertEquals(right.x+right.width,b.x+b.width);inside(safe,a);inside(safe,b);
    }
    @Test public void tinyScreensAndCutoutsNeverPutControlsOffscreen(){
        Random random=new Random(77);
        for(int i=0;i<5000;i++){
            OverlayGeometry.Box safe=new OverlayGeometry.Box(20+random.nextInt(140),40+random.nextInt(160),150+random.nextInt(2000),150+random.nextInt(2500));
            OverlayGeometry.Box bubble=OverlayGeometry.bubble(safe,144,random.nextInt(4000)-500,random.nextInt(4000)-500);
            inside(safe,bubble);inside(safe,OverlayGeometry.panel(safe,bubble,960,1100));
        }
    }
    @Test public void normalizedPositionsSurviveRotationAndClampBadSettings(){
        OverlayGeometry.Box portrait=new OverlayGeometry.Box(20,80,1040,2200),landscape=new OverlayGeometry.Box(120,20,2180,960);
        OverlayGeometry.Box a=OverlayGeometry.restore(portrait,144,1,.7f),b=OverlayGeometry.restore(landscape,144,1,.7f);
        assertEquals(portrait.x+portrait.width,a.x+a.width);assertEquals(landscape.x+landscape.width,b.x+b.width);
        inside(portrait,a);inside(landscape,b);
        inside(portrait,OverlayGeometry.restore(portrait,144,Float.NaN,Float.POSITIVE_INFINITY));
        inside(portrait,OverlayGeometry.restore(portrait,144,-4,9));
    }
}
